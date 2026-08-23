/* ============================================================
 * chars.js - 角色数据 (黎明迷局)
 * 8 求生者 + 4 监管者：数值 / 技能 / 定位 / 背景 / 程序化绘制样式
 * ============================================================ */

var SURVIVORS = [
  {
    id: 'med', name: '艾莉娅', title: '圣光医者',
    bg: '曾在前线医院救死扶伤的军医，某场手术里，她看到了不该存在的"病人"。',
    color: '#e8f1ff',
    position: '辅助', contribution: '快速治疗，稳住全队伤势',
    stats: { speed: 1.00, decode: 1.00, heal: 1.60, selfHeal: 1.60, vault: 1.00 },
    passive: { name: '妙手回春', desc: '治疗与自愈速度 +60%' },
    active: { name: '急救针剂', type: 'heal', cd: 40, duration: 0, desc: '立刻为最近队友（或自己）恢复一档伤势（重伤→轻伤→健康）' },
    style: { cloak: '#f2f6fb', trim: '#c9353f', hair: '#6a4a3a', skin: '#f0c8a0', hat: 'nurse', accent: '#d03a4a' }
  },
  {
    id: 'eng', name: '维克多', title: '傀儡师',
    bg: '钟表匠之子，为了唤醒昏迷的妹妹，造出了会呼吸的机械。',
    color: '#d8c07a',
    position: '破译', contribution: '远程修机，持续推进密码机',
    stats: { speed: 0.96, decode: 1.55, heal: 0.80, selfHeal: 0.80, vault: 1.00 },
    passive: { name: '机械精通', desc: '修机速度 +50%；受伤后修机速度 -25%' },
    active: { name: '遥控傀儡', type: 'ghost_decode', cd: 45, duration: 25, desc: '释放机械傀儡，25 秒内自动为最近的未完成密码机增加进度（可叠加）' },
    style: { cloak: '#7a5a2e', trim: '#c9a25a', hair: '#3a2a18', skin: '#efc39a', hat: 'goggles', accent: '#d9a441' }
  },
  {
    id: 'dec', name: '塞西莉亚', title: '灵犀之眼',
    bg: '宫廷密码员，能读懂一切被"涂抹"过的秘密。',
    color: '#b8a8e8',
    position: '破译', contribution: '稳定校准，爆发提升修机速度',
    stats: { speed: 1.00, decode: 1.15, heal: 1.00, selfHeal: 1.00, vault: 1.00 },
    passive: { name: '精妙校准', desc: '校准完美区 +60%，且校准失败不损失进度（永不炸机）' },
    active: { name: '灵光一现', type: 'decode_boost', cd: 50, duration: 12, desc: '12 秒内修机速度 +100%' },
    style: { cloak: '#4a3a6a', trim: '#c0a8f0', hair: '#8a6aa0', skin: '#f2d0ae', hat: 'beret', accent: '#b9a0ee' }
  },
  {
    id: 'run', name: '杰克', title: '疾风之子',
    bg: '马戏团的飞人，靠风与绳索在生死之间起舞。',
    color: '#f0b0a0',
    position: '牵制', contribution: '高速转点，为队友争取破译时间',
    stats: { speed: 1.13, decode: 0.90, heal: 0.90, selfHeal: 0.90, vault: 1.50 },
    passive: { name: '迅捷之足', desc: '移速 +12%，翻窗速度 +50%' },
    active: { name: '疾风冲刺', type: 'sprint', cd: 22, duration: 2.5, desc: '2.5 秒内移速 +65%' },
    style: { cloak: '#b8483a', trim: '#e8d8c0', hair: '#5a3a28', skin: '#f0c39a', hat: 'scarf', accent: '#e6d0b8' }
  },
  {
    id: 'gua', name: '奥古斯特', title: '钢铁之誓',
    bg: '退役骑士，以伤痕为勋章，誓言守护到最后一人。',
    color: '#a8b8c8',
    position: '救援', contribution: '护盾保人，提升救援容错',
    stats: { speed: 0.97, decode: 1.00, heal: 1.15, selfHeal: 1.15, vault: 1.00 },
    passive: { name: '铁壁', desc: '受击后获得 1.5 秒的 50% 减伤' },
    active: { name: '守护屏障', type: 'shield', cd: 60, duration: 0, desc: '为最近队友（或自己）施加护盾，抵挡下一次攻击' },
    style: { cloak: '#7a8a9a', trim: '#cfd8e0', hair: '#c8a878', skin: '#eec7a2', hat: 'knight', accent: '#d0a060' }
  },
  {
    id: 'gho', name: '露娜', title: '暗影之息',
    bg: '在迷雾中长大的孤儿，天生与黑暗为伴。',
    color: '#9aa8c8',
    position: '牵制', contribution: '隐匿脱身，打断监管者追击',
    stats: { speed: 1.00, decode: 1.00, heal: 0.90, selfHeal: 0.90, vault: 1.00 },
    passive: { name: '幽影', desc: '心跳感知范围 -35%，更难被监管者发现' },
    active: { name: '遁形', type: 'invisible', cd: 35, duration: 8, desc: '隐身 8 秒，监管者无法锁定；蹲伏状态下延长至 11 秒' },
    style: { cloak: '#2e2e4a', trim: '#9aa8c8', hair: '#c0c8d8', skin: '#f0d6c0', hat: 'hood', accent: '#aab6e8' }
  },
  {
    id: 'quo', name: '伊芙琳', title: '星语占卜师',
    bg: '雾夜塔罗师，能占卜命运，却总在迷雾里看见自己沦为星辰的祭品。',
    color: '#b8c8f8',
    position: '牵制', contribution: '闪现转点，快速拉开身位',
    stats: { speed: 1.04, decode: 1.00, heal: 0.90, selfHeal: 0.90, vault: 1.10 },
    passive: { name: '星见之眼', desc: '危机感知范围 +30%，更早察觉监管者逼近' },
    active: { name: '命运闪回', type: 'warp', cd: 26, duration: 0, desc: '朝移动方向闪现 150px 脱离险境（不可穿墙）' },
    style: { cloak: '#4a4a7a', trim: '#c0a8f0', hair: '#d8d0f0', skin: '#f2d0b0', hat: 'hood', accent: '#b9a8ee' }
  },
  {
    id: 'art', name: '奥德里奇', title: '钟楼工匠',
    bg: '守护修道院钟楼的机械师，用齿轮与发条对抗迷雾里的怪物。',
    color: '#c8b090',
    position: '破译', contribution: '直接完工，抢下关键密码机',
    stats: { speed: 0.95, decode: 1.20, heal: 1.00, selfHeal: 1.00, vault: 1.00 },
    passive: { name: '机巧维修', desc: '修机速度 +20%，校准失败不损失进度' },
    active: { name: '机芯完工', type: 'repair', cd: 55, duration: 0, desc: '破译中按下：立即直接完成当前密码机' },
    style: { cloak: '#6a5a40', trim: '#d8b46a', hair: '#4a3a2a', skin: '#eec39a', hat: 'cap', accent: '#d0a050' }
  }
];

var HUNTERS = [
  {
    id: 'hun_chase', name: '影鸦', title: '雾中刽子手',
    bg: '没有人见过雾中刽子手的脸，只有镰刀的寒光在雾里忽明忽灭。',
    color: '#d04040',
    position: '追击', contribution: '冲刺贴身，快速击倒落单目标',
    stats: { speed: 1.07, atkCd: 2.6, atkRange: 52, vision: 300, vault: 0.7 },
    passive: { name: '追猎本能', desc: '命中求生者后 2 秒内移速 +15%' },
    active: { name: '影袭', type: 'dash', cd: 18, duration: 1.6, desc: '朝面向方向高速冲刺 1.6 秒，冲刺中命中可直接击倒' },
    style: { cloak: '#1c1c2a', trim: '#5a1a1a', glow: '#ff4040', weapon: 'sickle' }
  },
  {
    id: 'hun_tele', name: '迷雾夫人', title: '传送怨灵',
    bg: '穿着华服的怨灵，在迷雾间穿梭，俯瞰众生如棋盘上的棋子。',
    color: '#b0a0e0',
    position: '控场', contribution: '传送守机，掌握全场目标位置',
    stats: { speed: 0.94, atkCd: 3.3, atkRange: 46, vision: 290, vault: 0.8 },
    passive: { name: '迷雾感知', desc: '求生者修机校准失败时会暴露位置' },
    active: { name: '空间传送', type: 'teleport', cd: 30, duration: 0, desc: '传送至最近的未完成密码机旁' },
    active2: { name: '全视之眼', type: 'reveal', cd: 50, duration: 4, desc: '4 秒内显示所有求生者位置' },
    style: { cloak: '#3a3358', trim: '#c8b8f0', glow: '#c0a8ff', weapon: 'staff' }
  },
  {
    id: 'hun_cage', name: '摩洛克', title: '缚骨陷阱师',
    bg: '用铁笼与锁链捕捉猎物的狱卒，把所有逃者钉在雾中。',
    color: '#e0a050',
    position: '控场', contribution: '陷阱封路，限制求生者转点',
    stats: { speed: 1.00, atkCd: 2.9, atkRange: 50, vision: 280, vault: 0.75 },
    passive: { name: '枷锁牢笼', desc: '命中后目标 1.2 秒移速 -25%' },
    active: { name: '铁笼陷阱', type: 'trap', cd: 22, duration: 0, desc: '在面前放置铁笼陷阱（对求生者隐形，踩中显现并定身 1.5 秒；最多同时 3 个）' },
    active2: { name: '全视之眼', type: 'reveal', cd: 45, duration: 4, desc: '4 秒内显示所有求生者位置' },
    style: { cloak: '#5a3a20', trim: '#c0a060', glow: '#ffb860', weapon: 'claw' }
  },
  {
    id: 'hun_heavy', name: '格罗姆', title: '碎骨重锤',
    bg: '来自雾底矿场的暴君，一锤落下，连墓碑都化为齑粉。',
    color: '#c86040',
    position: '追击', contribution: '范围伤害与眩晕，压缩走位空间',
    stats: { speed: 0.92, atkCd: 3.0, atkRange: 58, vision: 275, vault: 0.6 },
    passive: { name: '碎骨之击', desc: '命中造成震荡，目标 2.5 秒移速 -12%' },
    active: { name: '震荡波', type: 'quake', cd: 26, duration: 0, desc: '朝面前释放冲击波，波及求生者掉 1 点血并击晕 1.2 秒' },
    active2: { name: '全视之眼', type: 'reveal', cd: 50, duration: 4, desc: '4 秒内显示所有求生者位置' },
    style: { cloak: '#3a2a2a', trim: '#8a5a3a', glow: '#ff7a50', weapon: 'hammer' }
  }
];

function getSurvivor(id) { for (var i = 0; i < SURVIVORS.length; i++) if (SURVIVORS[i].id === id) return SURVIVORS[i]; return SURVIVORS[0]; }
function getHunter(id) { for (var i = 0; i < HUNTERS.length; i++) if (HUNTERS[i].id === id) return HUNTERS[i]; return HUNTERS[0]; }

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SURVIVORS: SURVIVORS, HUNTERS: HUNTERS, getSurvivor: getSurvivor, getHunter: getHunter };
}
