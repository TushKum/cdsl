'use strict';
// Server copy of the app's simulated market. It must stay identical to the
// "Market data" block in app/index.html; test/market.test.js checks that.

const HIST = 20, PLAY = 60, N = HIST + PLAY, START_CASH = 100000, HAIRCUT = 25;
const STOCKS = [
  {s:'RELIANCE',  n:'Reliance Industries',       hn:'रिलायंस इंडस्ट्रीज',      isin:'INE002A01018', p:1420, v:.014, dr:.0004},
  {s:'TCS',       n:'Tata Consultancy Services', hn:'टाटा कंसल्टेंसी सर्विसेज़', isin:'INE467B01029', p:3450, v:.012, dr:.0002},
  {s:'HDFCBANK',  n:'HDFC Bank',                 hn:'एचडीएफ़सी बैंक',          isin:'INE040A01034', p:1680, v:.011, dr:.0003},
  {s:'INFY',      n:'Infosys',                   hn:'इंफ़ोसिस',                isin:'INE009A01021', p:1520, v:.013, dr:.0003},
  {s:'ITC',       n:'ITC',                       hn:'आईटीसी',                 isin:'INE154A01025', p:430,  v:.010, dr:.0003},
  {s:'SBIN',      n:'State Bank of India',       hn:'भारतीय स्टेट बैंक',        isin:'INE062A01020', p:810,  v:.015, dr:.0004},
  {s:'TATAMOTORS',n:'Tata Motors',               hn:'टाटा मोटर्स',              isin:'INE155A01022', p:690,  v:.019, dr:.0001},
  {s:'HINDUNILVR',n:'Hindustan Unilever',        hn:'हिंदुस्तान यूनिलीवर',       isin:'INE030A01027', p:2450, v:.010, dr:.0001},
  {s:'ASIANPAINT',n:'Asian Paints',              hn:'एशियन पेंट्स',             isin:'INE021A01026', p:2380, v:.013, dr:.0000},
  {s:'BHARTIARTL',n:'Bharti Airtel',             hn:'भारती एयरटेल',             isin:'INE397D01024', p:1890, v:.013, dr:.0005}
];
const SMAP = Object.fromEntries(STOCKS.map(s => [s.s, s]));
const CA = [
  {id:'c1', day:4,  type:'div',   sym:'ITC',        amt:6.5},
  {id:'c2', day:8,  type:'bonus', sym:'INFY',       f:2},
  {id:'c3', day:12, type:'split', sym:'ASIANPAINT', f:5}
];
const BROKERS = [
  {id:'b1', dp:'12081600', name:'Sahaj Securities'},
  {id:'b2', dp:'12033200', name:'Gaon Invest'},
  {id:'b3', dp:'12010900', name:'Kiran Capital'}
];
const MILESTONES = ['onboard','buy','settle','sell','cas','corp','pledge','nominee','vote','scam'];
const LESSONS = ['accounts','kyc','boid','order','settlement','alerts','tpin','pnl','bench','cas','dividend','bonus','split','pledge','nominee','evoting','scam'];
// Correct answers to the five Scam Shield messages, in order
const SCAM_KEY = ['scam','safe','scam','scam','safe'];

function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
function gauss(r){let u=0;while(u===0)u=r();const v=r();return Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v);}

const PX = {}, RAW = {};
(function(){
  const r = mulberry32(20260601);
  STOCKS.forEach(st=>{
    let p = st.p; const a = [];
    for(let i=0;i<N;i++){ if(i>0) p = p*Math.exp(st.dr + st.v*gauss(r)); a.push(p); }
    PX[st.s] = a;
  });
  Object.keys(PX).forEach(k=>{ RAW[k] = PX[k].slice(); });
  CA.forEach(c=>{
    const a = PX[c.sym];
    for(let i=c.day+HIST;i<N;i++){ if(c.type==='div') a[i]-=c.amt; else a[i]/=c.f; }
  });
  Object.keys(PX).forEach(k=>{ PX[k] = PX[k].map(x=>Math.round(x*20)/20); });
})();

function price(sym, day){
  const d = Math.max(-HIST, Math.min(PLAY-1, day));
  return PX[sym][d+HIST];
}
// Equal-weight benchmark value of ₹1,00,000 invested on day 0
function marketValue(day){
  let r = 0;
  STOCKS.forEach(s => { r += RAW[s.s][day+HIST]/RAW[s.s][HIST]; });
  return START_CASH*r/STOCKS.length;
}

module.exports = {HIST, PLAY, N, START_CASH, HAIRCUT, STOCKS, SMAP, CA, BROKERS, MILESTONES, LESSONS, SCAM_KEY, PX, RAW, price, marketValue};
