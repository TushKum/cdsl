/* Shared helpers for the server-backed pages: language switch, API calls and labels. */
(function(){
  'use strict';
  var P = window.PK = {};
  P.lang = 'en';
  try{ var l = localStorage.getItem('pk.site.lang'); if(l === 'hi' || l === 'en') P.lang = l; else if((navigator.language||'').toLowerCase().indexOf('hi') === 0) P.lang = 'hi'; }catch(e){}

  P.LABELS = {
    en: {
      ms: {onboard:'Opened demat account', buy:'First purchase', settle:'Saw T+1 settlement', sell:'Sold with TPIN', cas:'Checked CAS', corp:'Corporate action', pledge:'Pledged shares', nominee:'Added nominee', vote:'Voted in AGM', scam:'Finished Scam Shield'},
      lesson: {accounts:'Trading vs demat', kyc:'KYC', boid:'BO ID', order:'Buying', settlement:'T+1 settlement', alerts:'Depository alerts', tpin:'TPIN & eDIS', pnl:'Gain/loss', bench:'Market comparison', cas:'CAS', dividend:'Dividend', bonus:'Bonus shares', split:'Stock split', pledge:'Pledging', nominee:'Nomination', evoting:'Shareholder rights', scam:'Spotting scams'},
      scam: ['“300% guaranteed” scheme', 'Real CDSL credit alert', 'Unregistered “stock guru”', 'Fake KYC block, asks TPIN/OTP', 'SEBI-registered adviser'],
      ans: {safe:'Safe', scam:'Scam'}
    },
    hi: {
      ms: {onboard:'डीमैट अकाउंट खोला', buy:'पहली खरीद', settle:'T+1 सेटलमेंट देखा', sell:'TPIN से बेचा', cas:'CAS जाँचा', corp:'कॉर्पोरेट एक्शन', pledge:'शेयर गिरवी रखे', nominee:'नॉमिनी जोड़ा', vote:'AGM में वोट', scam:'स्कैम शील्ड पूरा'},
      lesson: {accounts:'ट्रेडिंग बनाम डीमैट', kyc:'KYC', boid:'BO ID', order:'खरीदना', settlement:'T+1 सेटलमेंट', alerts:'डिपॉज़िटरी अलर्ट', tpin:'TPIN और eDIS', pnl:'लाभ/हानि', bench:'बाज़ार से तुलना', cas:'CAS', dividend:'डिविडेंड', bonus:'बोनस शेयर', split:'स्टॉक स्प्लिट', pledge:'गिरवी', nominee:'नॉमिनेशन', evoting:'शेयरधारक अधिकार', scam:'धोखाधड़ी पहचानना'},
      scam: ['"300% गारंटी" वाली स्कीम', 'असली CDSL जमा अलर्ट', 'बिना रजिस्ट्रेशन "स्टॉक गुरु"', 'नक़ली KYC ब्लॉक, TPIN/OTP माँगा', 'SEBI-रजिस्टर्ड सलाहकार'],
      ans: {safe:'सुरक्षित', scam:'धोखा'}
    }
  };
  P.L = function(){ return P.LABELS[P.lang]; };

  // dict = {en:{key:text}, hi:{key:text}}; elements carry data-i="key"
  P.i18n = function(dict){
    P.dict = dict;
    var nodes = document.querySelectorAll('[data-i]');
    nodes.forEach(function(n){ var k = n.getAttribute('data-i'); if(dict[P.lang] && dict[P.lang][k] != null) n.innerHTML = dict[P.lang][k]; });
    document.documentElement.lang = P.lang;
    var b = document.getElementById('lang'); if(b) b.textContent = P.lang === 'hi' ? 'English' : 'हिंदी';
  };
  P.t = function(k, v){
    var s = (P.dict[P.lang] && P.dict[P.lang][k]) || P.dict.en[k] || k;
    if(v) s = s.replace(/\{(\w+)\}/g, function(m, x){ return v[x] != null ? v[x] : m; });
    return s;
  };
  P.onLang = function(cb){
    var b = document.getElementById('lang');
    b.addEventListener('click', function(){
      P.lang = P.lang === 'hi' ? 'en' : 'hi';
      try{ localStorage.setItem('pk.site.lang', P.lang); }catch(e){}
      P.i18n(P.dict); cb();
    });
  };

  // API base: ?api=https://server (remembered), else this page's own origin when served over http(s)
  P.base = (function(){
    try{ var q = new URLSearchParams(location.search).get('api'); if(q && /^https?:\/\//.test(q)){ localStorage.setItem('pk.api', q.replace(/\/+$/,'')); } }catch(e){}
    try{ var s = localStorage.getItem('pk.api'); if(s) return s; }catch(e){}
    return /^https?:$/.test(location.protocol) ? location.origin : null;
  })();
  P.api = function(method, path, body, token){
    if(!P.base) return Promise.resolve({status:0, data:null});
    var h = {'Content-Type':'application/json'}; if(token) h.Authorization = 'Bearer ' + token;
    return fetch(P.base + path, {method:method, headers:h, body: body === undefined ? undefined : JSON.stringify(body)})
      .then(function(r){ return r.text().then(function(x){ var d = null; try{ d = x ? JSON.parse(x) : null; }catch(e){} return {status:r.status, data:d}; }); })
      .catch(function(){ return {status:0, data:null}; });
  };
  // Free-plan servers sleep when idle and take up to a minute to answer the first request,
  // so a "waking up" note (#waking) appears if the check is slow. #eph shows on servers whose data is temporary.
  P.health = function(){
    var w = document.getElementById('waking'), slow = setTimeout(function(){ if(w) w.hidden = false; }, 2500);
    return P.api('GET', '/api/health').then(function(r){
      clearTimeout(slow); if(w) w.hidden = true;
      var ok = r.status === 200 && r.data && r.data.service === 'pehla-kadam';
      var e = document.getElementById('eph'); if(e) e.hidden = !(ok && r.data.ephemeral);
      return ok;
    });
  };

  P.esc = function(s){ return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); };
  P.num = function(n, d){ try{ return Number(n).toLocaleString('en-IN', {minimumFractionDigits:d||0, maximumFractionDigits:d||0}); }catch(e){ return String(n); } };
  P.money = function(n){ return '₹' + P.num(Math.round(n)); };
  P.pct = function(n){ return (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n).toFixed(1) + '%'; };
  P.bar = function(label, value, pct, low){
    return '<div class="brow' + (low ? ' low' : '') + '"><div class="lab"><span>' + label + '</span><b>' + value + '</b></div><div class="tr" role="img" aria-label="' + P.esc(label) + ': ' + P.esc(value) + '"><i style="width:' + Math.max(0, Math.min(100, pct)) + '%"></i></div></div>';
  };
})();
