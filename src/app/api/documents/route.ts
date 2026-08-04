import { NextResponse } from "next/server";
import { handleRouteError } from "@/lib/api";
import { requireWorkspace } from "@/lib/auth-guard";
import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { getExtension, validateUpload } from "@/lib/ingest/validate-upload";
import { getStorage } from "@/lib/storage";

export async function GET() {
  try {
    const { workspaceId } = await requireWorkspace();

    const documents = await prisma.document.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        originalFilename: true,
        mimeType: true,
        sizeBytes: true,
        status: true,
        errorMessage: true,
        chunkCount: true,
        createdAt: true,
      },
    });

    return NextResponse.json({ documents });
  } catch (error) {
    return handleRouteError(error, "GET /api/documents");
  }
}

export async function POST(request: Request) {
  try {
    const { workspaceId } = await requireWorkspace();
    const env = getEnv();

    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    // Reject on the declared size before buffering the whole body.
    if (file.size > env.MAX_UPLOAD_BYTES) {
      const mb = (env.MAX_UPLOAD_BYTES / 1_048_576).toFixed(1);
      return NextResponse.json(
        { error: `File exceeds the ${mb} MB limit` },
        { status: 413 },
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());

    const validation = validateUpload({
      filename: file.name,
      mimeType: file.type,
      sizeBytes: buffer.byteLength,
      head: buffer.subarray(0, 8),
      maxBytes: env.MAX_UPLOAD_BYTES,
    });

    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    // Create the row first so the storage key can be derived from its ID.
    // The user's filename never appears in a filesystem path.
    const document = await prisma.document.create({
      data: {
        workspaceId,
        originalFilename: validation.safeFilename,
        mimeType: file.type || "application/octet-stream",
        sizeBytes: buffer.byteLength,
        storageKey: "pending",
        status: "uploaded",
      },
    });

    const storageKey = `${workspaceId}/${document.id}${getExtension(validation.safeFilename)}`;

    try {
      await getStorage().put(storageKey, buffer, document.mimeType);
    } catch (cause) {
      // Don't leave a row pointing at a file that was never written.
      await prisma.document.delete({ where: { id: document.id } });
      throw cause;
    }

    await prisma.document.update({
      where: { id: document.id },
      data: { storageKey },
    });

    return NextResponse.json({ id: document.id, status: "uploaded" }, { status: 201 });
  } catch (error) {
    return handleRouteError(error, "POST /api/documents");
  }
}
