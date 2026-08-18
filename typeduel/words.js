/* =====================================================================
 * words.js —— 《打字对决 TYPE DUEL》内置词库（独立数据文件）
 * 结构遵循设计文档 §5.1：window.WORDS = { tiers, shield, bonus, skills, boss, pick, random }
 * 词表按 §5.2 / §5.3 抄录（频率优先排序），纯数据、零依赖。
 * 兼容浏览器（window.WORDS）与 node（module.exports）双环境，便于自测。
 * ===================================================================== */
(function (global) {
  'use strict';

  var WORDS = {
    /* —— 4 档词长（L1 2-4 / L2 5-7 / L3 8-10 / L4 11+），每档 ≥30 词 —— */
    tiers: {
      1: [
        "at","be","by","do","go","he","if","in","is","it","me","my","no","of","on",
        "or","so","to","up","we","act","all","and","any","are","ask","bad","big",
        "box","but","can","car","day","did","dog","end","eye","far","few","for",
        "fun","get","got","had","has","her","him","his","hot","how","ice","its",
        "job","key","let","lot","man","may","new","not","now","off","old","one",
        "out","own","put","red","run","say","see","she","sit","six","sky","sun",
        "ten","the","too","top","two","use","was","way","who","why","win","yes","yet"
      ],
      2: [
        "about","after","again","apple","asked","black","block","blood","board",
        "break","bring","build","carry","catch","chair","check","child","clean",
        "clear","click","clock","close","cloud","color","could","count","cover",
        "crazy","cross","dance","dream","drive","earth","early","eight","every",
        "field","fight","final","first","flash","floor","force","found","frame",
        "fresh","front","glass","great","green","group","guess","happy","heart",
        "hello","house","human","image","issue","jump","level","light","magic",
        "maybe","metal","money","music","never","night","north","ocean","order",
        "other","paper","party","peace","phone","piano","piece","pilot","pixel",
        "place","plant","point","power","price","proud","queen","quick","quiet",
        "quite","radio","range","ready","right","river","round","score","screen",
        "seven","share","sharp","short","skill","sleep","small","smile","sound",
        "space","speed","spell","sport","stage","start","state","still","stone",
        "story","super","sweet","table","teach","thank","their","there","these",
        "thing","think","three","throw","tiger","title","today","tower","track",
        "train","treat","tree","trial","trick","trust","truth","twice","under",
        "video","voice","water","where","white","whole","world","worry","wrong",
        "write","youth"
      ],
      3: [
        "accurate","activity","adventure","alphabet","amazing","analysis","ancient",
        "anything","attention","audience","available","beautiful","birthday","building",
        "business","campaign","capital","capture","careful","champion","channel",
        "complete","computer","concrete","constant","continue","contract","creation",
        "critical","customer","dangerous","decision","delivery","describe","detailed",
        "develop","diamond","digital","discover","distance","document","download",
        "dramatic","electric","elements","employee","engineer","estimate","evidence",
        "exercise","exciting","explorer","familiar","featured","feedback","festival",
        "football","forecast","forward","fragment","framework","function","generate",
        "greatest","guardian","hardware","heritage","identity","imagine","important",
        "incredible","industry","infinite","instance","instruct","interest","internet",
        "interval","invasion","journey","keyboard","knowledge","language","laughter",
        "learning","lecture","library","location","magnetic","maintain","majority",
        "manager","marathon","material","medicine","message","military","minority",
        "mountain","movement","multiple","mystery","national","navigate","negative",
        "network","normal","notebook","numerous","obstacle","operator","opponent",
        "opposite","ordinary","organize","original","overcome","parallel","particle",
        "passport","patience","pattern","perform","periodic","personal","physical",
        "platform","possible","powerful","practice","precious","predict","prepare",
        "pressure","previous","priority","probably","producer","profile","program",
        "progress","project","property","protocol","purchase","quality","quantity",
        "quarter","question","quickly","reaction","receive","recover","reflect",
        "refresh","register","regular","remember","replace","require","research",
        "reserve","resource","response","restore","reverse","schedule","science",
        "security","serious","several","silence","similar","simplify","solution",
        "specific","spectrum","standard","starting","station","strategy","strength",
        "struggle","studying","subject","success","suggest","support","surprise",
        "surround","survival","symbol","system","tactical","talented","teaching",
        "technical","teenager","terminal","terrible","territory","thinking","thousand",
        "together","tomorrow","tonight","training","transfer","transport","treasure",
        "triangle","trigger","ultimate","universe","unusual","valuable","variable",
        "various","velocity","version","victory","village","visible","vision","volume",
        "warrior","whatever","window","wireless","wonderful","workshop","yourself"
      ],
      4: [
        "achievement","alternative","atmosphere","beautiful","breakthrough","calculator",
        "celebration","challenge","championship","comfortable","complicated","component",
        "concentrate","conference","connection","construction","coordinate","corporation",
        "declaration","definition","destination","development","difference","difficulty",
        "dimension","distribution","educational","effectively","electricity","emergency",
        "engineering","environment","especially","everything","examination","experience",
        "experiment","explanation","expression","extraordinary","foundation","fundamental",
        "generation","geography","government","graduation","immediately","importance",
        "information","innovation","instruction","instrument","intelligence","interesting",
        "investigate","invitation","knowledge","laboratory","leadership","maintenance",
        "management","mathematics","measurement","mechanism","opportunity","organization",
        "participate","particular","performance","permanent","permission","personality",
        "perspective","phenomenon","philosophy","population","possibility","practical",
        "precious","prediction","preparation","president","priority","procedure","production",
        "profession","programmer","promotion","protection","psychology","reaction","reasonable",
        "recognize","recommend","reference","reflection","relationship","remember","renewable",
        "represent","requirement","researcher","resolution","resource","responsibility",
        "restaurant","revolution","scientific","secondary","secretary","settlement","signature",
        "significant","situation","software","something","sophisticated","spectacular","statistics",
        "strategy","structure","substantial","suggestion","surrounding","temperature","temporary",
        "territory","themselves","throughout","tomorrow","tradition","transaction","transition",
        "transparent","tremendous","ultimately","understand","university","unlimited","vibration",
        "vocabulary","volunteer","wonderful"
      ]
    },
    /* —— 护盾层短词池（2-5 字母，黄） —— */
    shield: ["red","gold","gate","lock","wave","fury","bolt","core","node","code","hex","ram","byte","data"],
    /* —— 奖励词（大写 4-6 字母，金色） —— */
    bonus: ["ZOOM","COOL","LUCK","EPIC","MAX","BONUS","TURBO","BLAZE","KING","WOW","GIFT","JACKPOT"],
    /* —— 技能词（小写，触发防御协议） —— */
    skills: ["heal","bomb","freeze","slow"],
    /* —— Boss 分段词池（赛博主题） —— */
    boss: ["prism","hacker","matrix","cyber","virus","trojan","breach","glitch","photon","signal","vector","kernel","pulse","gamma","delta","sonic","laser","fusion","neon","echo"]
  };

  /* —— 取词工具：从数组随机取 n 个不重复词 —— */
  function pickFrom(arr, n, avoid) {
    var pool = arr.slice();
    var out = [];
    var avoidMap = avoid || {};
    while (out.length < n && pool.length > 0) {
      var idx = Math.floor(Math.random() * pool.length);
      var w = pool[idx];
      pool.splice(idx, 1);
      if (avoidMap[w]) continue;
      out.push(w);
    }
    return out;
  }

  /* 从指定档随机取 n 个不重复词 */
  WORDS.pick = function (tierKey, n, avoid) {
    var arr = WORDS.tiers[tierKey] || WORDS.tiers[1];
    return pickFrom(arr, n, avoid);
  };

  /* 按敌人类型取词 */
  WORDS.random = function (opt) {
    opt = opt || {};
    var w = "";
    if (opt.pool) {
      var pool = WORDS[opt.pool] || WORDS.tiers[1];
      var i = Math.floor(Math.random() * pool.length);
      w = pool[i];
    } else {
      var tier = opt.tier || 1;
      var arr = WORDS.tiers[tier] || WORDS.tiers[1];
      var j = Math.floor(Math.random() * arr.length);
      w = arr[j];
    }
    if (opt.upper) w = w.toUpperCase();
    return w;
  };

  /* —— 双环境导出 —— */
  if (typeof window !== 'undefined') { window.WORDS = WORDS; }
  if (typeof module !== 'undefined' && module.exports) { module.exports = WORDS; }
})(typeof window !== 'undefined' ? window : globalThis);
