/* PAC-MAN 完整版 - 音效 (audio.js) WebAudio 全程序化合成, 零外部音频 */
'use strict';
(function(win){
var PAC = win.PAC = win.PAC || {};

var AudioMgr = function(){
  this.ctx = null; this.master = null;
  this.sirenNodes = null; this.sirenOn = false;
  this.frightNodes = null; this.frightOn = false;
  this._vol = 0.8; this._muted = false;
  this._lastWakka = false;
  try{ this._vol = parseFloat(localStorage.getItem('pm_volume')) || 0.8;
       this._muted = localStorage.getItem('pm_muted')==='1'; }catch(e){}
};

AudioMgr.prototype = {
  unlock:function(){
    if(this.ctx) return;
    try{
      var AC = win.AudioContext || win.webkitAudioContext;
      if(!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this._muted?0:this._vol;
      this.master.connect(this.ctx.destination);
      if(this.ctx.state==='suspended') this.ctx.resume();
    }catch(e){}
  },
  setVolume:function(v){ this._vol=Math.max(0,Math.min(1,v));
    if(this.master) this.master.gain.value = this._muted?0:this._vol;
    try{ localStorage.setItem('pm_volume',String(this._vol)); }catch(e){} },
  getVolume:function(){ return this._vol; },
  setMuted:function(m){ this._muted=!!m;
    if(this.master) this.master.gain.value = m?0:this._vol;
    try{ localStorage.setItem('pm_muted',m?'1':'0'); }catch(e){} },
  isMuted:function(){ return this._muted; },
  // ---- 基础合成工具 ----
  tone:function(freq, dur, type, vol, slide, delay){
    if(!this.ctx||this._muted) return;
    var t0 = this.ctx.currentTime + (delay||0);
    var o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type||'square';
    o.frequency.setValueAtTime(freq, t0);
    if(slide) o.frequency.exponentialRampToValueAtTime(Math.max(20,slide), t0+dur);
    g.gain.setValueAtTime(vol||0.2, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0+dur);
    o.connect(g); g.connect(this.master);
    o.start(t0); o.stop(t0+dur+0.02);
  },
  noise:function(dur, vol, freq, q){
    if(!this.ctx||this._muted) return;
    var t0 = this.ctx.currentTime;
    var len = Math.floor(this.ctx.sampleRate*dur);
    var buf = this.ctx.createBuffer(1,len,this.ctx.sampleRate);
    var d = buf.getChannelData(0);
    for(var i=0;i<len;i++) d[i]=(Math.random()*2-1)*(1-i/len);
    var src = this.ctx.createBufferSource(); src.buffer=buf;
    var f = this.ctx.createBiquadFilter(); f.type='bandpass';
    f.frequency.value = freq||1000; f.Q.value = q||1;
    var g = this.ctx.createGain(); g.gain.value=vol||0.2;
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t0); src.stop(t0+dur);
  },
  // ---- 具体音效 ----
  wakka:function(){ // 吃豆交替双音
    this._lastWakka = !this._lastWakka;
    this.tone(this._lastWakka?520:410, 0.09, 'square', 0.12, 190);
  },
  pellet:function(){ // 大力丸: 上升琶音
    this.tone(300,0.08,'sawtooth',0.14,470);
    this.tone(620,0.08,'sawtooth',0.14,900,0.07);
    this.tone(940,0.12,'sawtooth',0.12,1400,0.14);
  },
  eatGhost:function(){ // 反吃幽灵: 快速下滑
    var base = 900;
    for(var i=0;i<4;i++) this.tone(base-i*130, 0.05, 'square', 0.16, base-(i+1)*160, i*0.05);
  },
  fruit:function(){ // 水果: 清脆琶音
    this.tone(660,0.09,'triangle',0.16,660);
    this.tone(880,0.09,'triangle',0.16,880,0.09);
    this.tone(1320,0.16,'triangle',0.14,1320,0.18);
  },
  death:function(){ // 死亡: 长下滑
    this.stopSiren(); this.stopFright();
    this.tone(500,0.9,'square',0.2,90);
    this.noise(0.5,0.08,300,1);
  },
  victory:function(){ // 过关: 上行琶音
    this.stopSiren(); this.stopFright();
    var seq=[392,523,659,784,1046];
    for(var i=0;i<seq.length;i++) this.tone(seq[i],0.16,'triangle',0.16,seq[i],i*0.12);
  },
  levelClear:function(){
    this.tone(523,0.12,'triangle',0.16,523);
    this.tone(659,0.12,'triangle',0.16,659,0.12);
    this.tone(784,0.12,'triangle',0.16,784,0.24);
    this.tone(1046,0.3,'triangle',0.18,1046,0.36);
  },
  gameOver:function(){
    this.tone(392,0.3,'sawtooth',0.16,392);
    this.tone(330,0.3,'sawtooth',0.16,330,0.3);
    this.tone(262,0.5,'sawtooth',0.18,180,0.6);
  },
  pauseTone:function(){ this.tone(440,0.08,'square',0.1,440); this.tone(330,0.1,'square',0.1,330,0.1); },
  bump:function(){ this.noise(0.12,0.2,600,2); this.tone(200,0.1,'square',0.1,120); },
  // ---- 持续循环音 ----
  startSiren:function(){ // 幽灵警笛(追逐)
    if(!this.ctx||this.sirenOn) return; this.sirenOn=true;
    var o=this.ctx.createOscillator(), g=this.ctx.createGain();
    o.type='square'; o.frequency.value=180;
    var lfo=this.ctx.createOscillator(), lg=this.ctx.createGain();
    lfo.frequency.value=2.4; lg.gain.value=60; lfo.connect(lg); lg.connect(o.frequency);
    g.gain.value=0.05; o.connect(g); g.connect(this.master);
    o.start(); lfo.start(); this.sirenNodes=[o,g,lfo,lg];
  },
  stopSiren:function(){ if(!this.sirenOn)return; this.sirenOn=false;
    if(this.sirenNodes){ this.sirenNodes[0].stop(); this.sirenNodes[2].stop(); this.sirenNodes=null; } },
  startFright:function(){ // 恐惧颤音
    if(!this.ctx||this.frightOn) return; this.frightOn=true;
    var o=this.ctx.createOscillator(), g=this.ctx.createGain();
    o.type='sawtooth'; o.frequency.value=300;
    var lfo=this.ctx.createOscillator(), lg=this.ctx.createGain();
    lfo.frequency.value=10; lg.gain.value=120; lfo.connect(lg); lg.connect(o.frequency);
    var g2=this.ctx.createGain(); g2.gain.value=0.07;
    var lfo2=this.ctx.createOscillator(), lg2=this.ctx.createGain();
    lfo2.frequency.value=5; lg2.gain.value=0.04; lfo2.connect(lg2); lg2.connect(g2.gain);
    o.connect(g); g.connect(g2); g2.connect(this.master);
    o.start(); lfo.start(); lfo2.start(); this.frightNodes=[o,g,lfo,lg,lfo2,g2];
  },
  stopFright:function(){ if(!this.frightOn)return; this.frightOn=false;
    if(this.frightNodes){ this.frightNodes[0].stop(); this.frightNodes[2].stop(); this.frightNodes[4].stop(); this.frightNodes=null; } },
  dispose:function(){ this.stopSiren(); this.stopFright(); },
};

PAC.Audio = new AudioMgr();
})(typeof window!=='undefined'?window:this);
