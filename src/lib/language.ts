/**
 * Which language a model should write in, decided by code rather than by
 * asking the model to "match the user".
 *
 * Hong Kong working text mixes scripts freely — "聽日要send個report俾client" is
 * Chinese with English nouns, not English. So the test is not "is there any
 * Latin text" but whether the Han characters carry the sentence: at least two
 * of them, and at least as many as there are Latin words. "Please email 陳生
 * tomorrow" stays English.
 */

export type ReplyLanguage = "zh-Hant" | "en";

const HAN = /\p{Script=Han}/gu;
const LATIN_WORD = /[A-Za-z]+/g;

export function detectReplyLanguage(
  text: string,
  fallback: ReplyLanguage,
): ReplyLanguage {
  const han = text.match(HAN)?.length ?? 0;
  const latinWords = text.match(LATIN_WORD)?.length ?? 0;

  if (han >= 2 && han >= latinWords) return "zh-Hant";
  if (latinWords > 0 && han < 2) return "en";
  if (latinWords > han) return "en";
  return fallback;
}

/** The prompt line that fixes the output language for one request. */
export function languageDirective(language: ReplyLanguage): string {
  return language === "zh-Hant"
    ? "Write every field you generate in Traditional Chinese as used in Hong Kong (繁體中文，香港用字). Never use Simplified Chinese characters. Keep English terms, names, product names, numbers, and codes exactly as the source wrote them."
    : "Write every field you generate in English. Keep names, numbers, and codes exactly as the source wrote them.";
}

/**
 * Characters that exist only in Simplified Chinese. Deliberately restricted to
 * forms with no ordinary Traditional use — 面, 里, 表, 范, 游, 降, 盖 and
 * similar are excluded because Traditional text uses them too, and a false alarm here
 * would fail a correct translation. Detection, not conversion: converting is
 * done by OpenCC on generated prose only.
 */
const SIMPLIFIED_ONLY = new Set(
  Array.from(
    "这个们说时会来对过还发经没为国学开么问实现长样进动种产点业关应头见间东车两让门话认电级专号报务网写处备钱单试议识战结验际双连达众约选质规题图难历岁乐书传亲虽总统热万条术读证资记权尽设类员决讲买卖顾观边运价张听闻须线练确纪组织给细终续该谁请调谈译诉语误论访评诊词许讯讨训远适递逻遗邮释针钟钢铁银锁错键闭闲阅队阳阴阶陆陈险随雾顺领频风飞饭馆马驻鱼鲁鸟龙块坏场够奖妇妈宁宝宽导层岛帅师带帮库异弹归当录忆态怀恶恼悬惊惯戏户执扩扫扬抢护担拥择挥损换掷摇摄敌数无旧显晓晒机杀杂杨极构枪柜标栏树桥梦检楼欢欧残毁毕气汇汉汤沟泪泽洁浅测济浓涛润涨渐湾湿满滚滞灭灯灵灾炉炼烦烧焕爱爷牵犹状独狭猎献环玛琐画畅疗疮疯痒皱监盘县码砖础硕碍礼祸离积称稳穷窃窍竞笔筛简箩篮粮紧纠红纯纱纲纳纵纷纸纹纺绅绍绑绕绘络绝绢继绩绳维绵综绿缓编缘缩缴罗罚罢义习翘职聪肃肠肤肾肿胀胁胜胶脑脱舰艺节芦苍苏苹茎茧荡荣药莱获莹营萧萨蓝蔼虏虑蚀蚁蛮补衬袄袜装褛视览觉触誉计订讳讼诗诚诞询详诸诺课谅谊谋谎谓谢谣谦谨谱贝负贡财责贤败账货贩贪贫购贯贱贴贵贷贸费贺贼赋赌赏赔赖赚赛赞赠赵赶趋跃践轨轮软轰轻载较辅辆辈辉输辖迁违迟逊邓邻郑酱酿钉钓钥钻铃铅铜铭铺链销锅锋锤锦锻镇镜闪闯闷闹阀阁阔阵陕隐雏鸡韦韩页顶项顽顿预颇颗颜额飘饥饮饰饱饲饶饼驱驳驴驶驾骂骑骗骚骤鲜鸣鸭鸿鹅鹰黄齐齿龄",
  ),
);

export function containsSimplified(text: string): boolean {
  for (const char of text) {
    if (SIMPLIFIED_ONLY.has(char)) return true;
  }
  return false;
}
