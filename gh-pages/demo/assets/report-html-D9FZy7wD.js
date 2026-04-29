function p(t){return t.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}function i(t){return Math.abs(t).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g,",")}function R(t){const[o,n,e]=t.split("-").map(Number);return new Date(o,n-1,e).toLocaleDateString("en-GB",{day:"numeric",month:"short"})}function et(t,o){const[n,e,y]=t.split("-").map(Number),[r,u,A]=o.split("-").map(Number),b=new Date(r,u-1,A).toLocaleDateString("en-GB",{day:"numeric",month:"long",year:"numeric"});if(e===u&&n===r)return`${y} – ${b}`;const x={day:"numeric",month:"long"};return n!==r&&(x.year="numeric"),`${new Date(n,e-1,y).toLocaleDateString("en-GB",x)} – ${b}`}function nt(t){const[o,n]=t.split("-").map(Number),e=n>=9?o:o-1;return`${e}/${String(e+1).slice(2)}`}function st(t){return t.type==="income"?t.status==="--"||t.status==="approved":t.type==="expense"?t.status==="approved":!1}function at(t){return t==="--"?"Auto":t.charAt(0).toUpperCase()+t.slice(1)}function U(t){return[...t].sort((o,n)=>o.date.localeCompare(n.date)||o.created_at.localeCompare(n.created_at))}function V(t,o,n){const e=new Map;for(const r of t){const u=r.category||"Other";e.has(u)||e.set(u,[]),e.get(u).push(r)}const y=[];for(const[r,u]of e){const A=u.reduce((f,m)=>f+(parseFloat(m.amount)||0),0),b=o>0?A/o*100:0,x=new Map;for(const f of u){const m=f.description||"Other",M=x.get(m)||{count:0,amount:0};M.count++,M.amount+=parseFloat(f.amount)||0,x.set(m,M)}const $=[...x.entries()].filter(([,f])=>{const m=f.count>=n.countThreshold,M=n.amountThreshold>0&&f.amount>=n.amountThreshold;return n.amountThreshold<=0?m:n.mode==="or"?m||M:m&&M}).sort((f,m)=>m[1].amount-f[1].amount).map(([f,m])=>({description:f,count:m.count,amount:m.amount}));y.push({category:r,count:u.length,total:A,pct:b,subItems:$})}return y.sort((r,u)=>u.total-r.total)}function ot(t){const o=new Map;for(const n of t){const e=n.activity||"General",y=o.get(e)||{income:0,expense:0,count:0},r=parseFloat(n.amount)||0;n.type==="income"?y.income+=r:y.expense+=r,y.count++,o.set(e,y)}return[...o.entries()].map(([n,e])=>({activity:n,income:e.income,expense:e.expense,net:e.income-e.expense,count:e.count})).sort((n,e)=>n.activity.localeCompare(e.activity))}const it='<svg width="38" height="38" viewBox="0 0 121.938 121.938" xmlns="http://www.w3.org/2000/svg"><g transform="translate(-44.031,-87.531)"><path fill="#89b0ae" d="m 150.907,87.593 c 0,0 0.555,2.782 0.326,5.82 -0.276,3.659 -1.667,7.685 -1.677,7.685 l -31.193,-0.413 c -7.355,-0.097 -12.409,0.903 -14.879,5.537 -3.048,5.719 -2.552,14.252 -2.552,14.252 l 0.053,19.541 c 0,0 4.281,-3.483 9.096,-3.482 l 26,0.006 c 0,0 -0.115,3.465 -0.481,6.189 -0.321,2.389 -2.344,6.959 -2.344,6.959 0,0 -18.275,-0.402 -22.384,0.217 -2.009,0.303 -4.238,2.608 -5.65,4.346 -1.413,1.739 -12.17,13.257 -12.17,13.257 0,0 7.715,6.302 7.824,15.864 0.965,7.422 -3.318,17.067 -10.648,22.144 -4.712,3.263 -13.474,3.934 -13.474,3.934 0.019,0.006 2.192,-1.627 4.077,-4.219 1.661,-2.283 3.086,-5.965 3.094,-8.277 0.017,-4.412 0.185,-17.184 0.185,-17.184 0,0 -0.066,-2.755 -2.358,-4.982 -2.423,-2.354 -14.778,-14.017 -14.778,-14.017 l 9.019,-9.779 7.497,7.171 13.039,-14.343 -12.713,-11.735 c 0.001,-11.855 -0.369,-25.396 5.9,-33.532 3.812,-4.948 10.821,-10.977 19.609,-11 23.347,-0.064 41.581,0.042 41.581,0.042 z"/><path fill="#313e50" d="m 59.433,113.56 v 95.909 l 16.98,-0.558 v -95.351 z"/><path fill="#313e50" d="m 85.864,87.531 c 0,0 -26.431,-0.172 -26.431,26.029 0,0 6.247,22.108 6.62,22.491 l 21.56,17.577 8.918,-9.809 -12.713,-11.735 -5.385,-5.385 c 0,0 -2.117,-1.429 -2.117,-4.247 l -0.093,-6.819 c 0.663,-12.098 8.022,-14.054 11.851,-14.568 0.49,-0.884 1.035,-1.725 1.643,-2.514 3.683,-4.78 10.35,-10.569 18.721,-10.978 z"/><path fill="#313e50" d="m 120.115,149.561 c -0.023,0.011 -3.016,1.434 -5.403,2.011 -2.695,0.652 -7.411,0.451 -7.432,0.45 l -2.145,2.334 c -1.719,2.054 -12.066,13.133 -12.082,13.15 0.021,0.017 7.715,6.315 7.823,15.864 0.061,0.472 0.102,0.952 0.121,1.44 v -19.908 h 9.485 c 0,0 13.233,1.003 22.775,-15.216 0,0 -6.877,-0.151 -13.142,-0.125 z"/><path fill="#313e50" d="m 143.709,101.021 c -0.004,0.003 -5.882,4.027 -8.801,4.986 -5.174,1.701 -9.579,1.426 -9.579,1.426 0,0 -14.264,0.096 -22.518,0.229 -2.298,5.606 -1.879,12.812 -1.879,12.812 0,0 23.541,-0.057 23.725,-0.074 6.075,-0.561 12.788,-3.436 17.695,-8.007 5.593,-5.211 7.203,-11.288 7.204,-11.295 z"/></g></svg>';function rt(t){if(t.length<2)return"";const o=300,n=160,e=48,y=8,r=12,u=28,A=o-e-y,b=n-r-u,x=t.map(s=>s.balance),$=Math.min(...x),m=Math.max(...x)-$||1,M=s=>e+s/(t.length-1)*A,T=s=>r+b-(s-$)/m*b,P=t.map((s,D)=>`${M(D).toFixed(1)},${T(s.balance).toFixed(1)}`).join(" "),N=P+` ${M(t.length-1).toFixed(1)},${(r+b).toFixed(1)} ${e.toFixed(1)},${(r+b).toFixed(1)}`,I=5,z=[];for(let s=0;s<=I;s++){const D=$+m*s/I,S=T(D);z.push(`<text x="${e-4}" y="${S.toFixed(1)}" text-anchor="end" font-size="6.5" fill="#64748b" dominant-baseline="middle">£${i(D)}</text>`),z.push(`<line x1="${e}" y1="${S.toFixed(1)}" x2="${(o-y).toFixed(1)}" y2="${S.toFixed(1)}" stroke="#e2e8f0" stroke-width="0.5"/>`)}const c=[],B=Math.max(1,Math.floor(t.length/5));for(let s=0;s<t.length;s+=B){const D=M(s);c.push(`<text x="${D.toFixed(1)}" y="${(n-4).toFixed(1)}" text-anchor="middle" font-size="6.5" fill="#64748b">${p(t[s].date)}</text>`)}if((t.length-1)%B!==0){const s=M(t.length-1);c.push(`<text x="${s.toFixed(1)}" y="${(n-4).toFixed(1)}" text-anchor="middle" font-size="6.5" fill="#64748b">${p(t[t.length-1].date)}</text>`)}return`<svg width="${o}" height="${n}" viewBox="0 0 ${o} ${n}" xmlns="http://www.w3.org/2000/svg" style="font-family:'IBM Plex Sans',sans-serif">
    ${z.join(`
    `)}
    ${c.join(`
    `)}
    <polygon points="${N}" fill="#89B0AE" opacity="0.15"/>
    <polyline points="${P}" fill="none" stroke="#89B0AE" stroke-width="1.5" stroke-linejoin="round"/>
  </svg>`}function lt(t){if(t.length===0)return"";const o=300,n=160,e=48,y=8,r=12,u=28,A=o-e-y,b=n-r-u,x=Math.max(...t.flatMap(c=>[c.income,c.expense]),1),$=A/t.length,f=Math.min($*.35,16),m=2,M=c=>r+b-c/x*b,T=4,P=[];for(let c=0;c<=T;c++){const B=x*c/T,s=M(B);P.push(`<text x="${e-4}" y="${s.toFixed(1)}" text-anchor="end" font-size="6.5" fill="#64748b" dominant-baseline="middle">£${i(B)}</text>`),P.push(`<line x1="${e}" y1="${s.toFixed(1)}" x2="${(o-y).toFixed(1)}" y2="${s.toFixed(1)}" stroke="#e2e8f0" stroke-width="0.5"/>`)}const N=[],I=[];for(let c=0;c<t.length;c++){const B=t[c],s=e+$*(c+.5),D=s-f-m/2,S=s+m/2,H=B.income/x*b,L=B.expense/x*b;N.push(`<rect x="${D.toFixed(1)}" y="${(r+b-H).toFixed(1)}" width="${f.toFixed(1)}" height="${H.toFixed(1)}" fill="#89B0AE" rx="1.5"/>`),N.push(`<rect x="${S.toFixed(1)}" y="${(r+b-L).toFixed(1)}" width="${f.toFixed(1)}" height="${L.toFixed(1)}" fill="#C07A72" rx="1.5"/>`),I.push(`<text x="${s.toFixed(1)}" y="${(n-4).toFixed(1)}" text-anchor="middle" font-size="6.5" fill="#64748b">${p(B.month)}</text>`)}const z=`
    <rect x="${e}" y="2" width="8" height="6" rx="1" fill="#89B0AE"/>
    <text x="${e+11}" y="7.5" font-size="6" fill="#64748b">Income</text>
    <rect x="${e+48}" y="2" width="8" height="6" rx="1" fill="#C07A72"/>
    <text x="${e+59}" y="7.5" font-size="6" fill="#64748b">Expense</text>`;return`<svg width="${o}" height="${n}" viewBox="0 0 ${o} ${n}" xmlns="http://www.w3.org/2000/svg" style="font-family:'IBM Plex Sans',sans-serif">
    ${z}
    ${P.join(`
    `)}
    ${N.join(`
    `)}
    ${I.join(`
    `)}
  </svg>`}function ct(t){const{title:o,startDate:n,endDate:e,generatedDate:y,sheetName:r,openingBalance:u=0,transactions:A,balanceData:b,monthlyData:x,plannedData:$,includeSummary:f=!0,includeCategories:m=!0,includeActivities:M=!1,includeTransactions:T=!0,subItemThreshold:P=5,subItemFilter:N}=t,I=N??{countThreshold:P,amountThreshold:0,mode:"or"},z=U(A.filter(a=>st(a))),c=z.filter(a=>a.type==="income"),B=z.filter(a=>a.type==="expense"),s=c.reduce((a,d)=>a+(parseFloat(d.amount)||0),0),D=B.reduce((a,d)=>a+(parseFloat(d.amount)||0),0),S=s-D,H=u+S;let L=u;const Y=new Map;for(const a of z){const d=parseFloat(a.amount)||0;a.type==="income"?L+=d:L-=d,Y.set(a.id,L)}const q=V(c,s,I),X=V(B,D,I),_=ot(z),J=et(n,e),K=nt(e),C=[];let k=0;if(f){const a=S>=0?"+":"–",d=S>=0?" positive":" negative",h=S>=0?"Surplus for period":"Deficit for period";C.push(`
  <div class="summary-band">
    <div class="metric">
      <div class="metric-label">Closing balance</div>
      <div class="metric-value">£${i(H)}</div>
      <div class="metric-sub">Opening: £${i(u)}</div>
    </div>
    <div class="metric">
      <div class="metric-label">Net movement</div>
      <div class="metric-value${d}">${a}£${i(S)}</div>
      <div class="metric-sub">${p(h)}</div>
    </div>
    <div class="metric">
      <div class="metric-label">Income</div>
      <div class="metric-value">£${i(s)}</div>
      <div class="metric-sub">${c.length} transactions</div>
    </div>
    <div class="metric">
      <div class="metric-label">Expenditure</div>
      <div class="metric-value">£${i(D)}</div>
      <div class="metric-sub">${B.length} transactions</div>
    </div>
  </div>`)}if(m){k++;const a=k;k++;const d=k,h=q.map(l=>{let v=`<tr>
      <td class="cat-name">${p(l.category)}</td>
      <td class="num">${l.count}</td>
      <td class="num">${i(l.total)}</td>
      <td class="share"><span class="bar income-bar" style="width:${Math.max(3,Math.round(l.pct*.4))}px"></span>${Math.round(l.pct)}%</td>
    </tr>`;for(const F of l.subItems)v+=`<tr class="sub-item">
      <td>${p(F.description)} <span class="sub-count">(${F.count})</span></td>
      <td></td>
      <td class="num">${i(F.amount)}</td>
      <td></td>
    </tr>`;return v}).join(""),g=X.map(l=>{let v=`<tr>
      <td class="cat-name">${p(l.category)}</td>
      <td class="num">${l.count}</td>
      <td class="num">(${i(l.total)})</td>
      <td class="share"><span class="bar expense-bar" style="width:${Math.max(3,Math.round(l.pct*.4))}px"></span>${Math.round(l.pct)}%</td>
    </tr>`;for(const F of l.subItems)v+=`<tr class="sub-item">
      <td>${p(F.description)} <span class="sub-count">(${F.count})</span></td>
      <td></td>
      <td class="num">(${i(F.amount)})</td>
      <td></td>
    </tr>`;return v}).join("");C.push(`
  <div class="two-col">
    <div class="col">
      <div class="section-header">
        <span class="section-num">${a}</span>
        <span class="section-name">Income by category</span>
        <span class="section-line"></span>
      </div>
      <table class="breakdown">
        <thead><tr>
          <th>Category</th>
          <th class="r">Count</th>
          <th class="r">Amount (£)</th>
          <th class="r">Share</th>
        </tr></thead>
        <tbody>
          ${h}
          <tr class="total-row">
            <td><strong>Total income</strong></td>
            <td class="num"><strong>${c.length}</strong></td>
            <td class="num"><strong>${i(s)}</strong></td>
            <td class="share"><strong>100%</strong></td>
          </tr>
        </tbody>
      </table>
    </div>
    <div class="col">
      <div class="section-header">
        <span class="section-num">${d}</span>
        <span class="section-name">Expenditure by category</span>
        <span class="section-line"></span>
      </div>
      <table class="breakdown">
        <thead><tr>
          <th>Category</th>
          <th class="r">Count</th>
          <th class="r">Amount (£)</th>
          <th class="r">Share</th>
        </tr></thead>
        <tbody>
          ${g}
          <tr class="total-row">
            <td><strong>Total expenditure</strong></td>
            <td class="num"><strong>${B.length}</strong></td>
            <td class="num"><strong>(${i(D)})</strong></td>
            <td class="share"><strong>100%</strong></td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>`)}const O=x&&x.length>0,G=b&&b.length>=2;if(O||G){let a="";O&&(k++,a=`
      <div>
        <div class="section-header">
          <span class="section-num">${k}</span>
          <span class="section-name">Income vs expense by month</span>
          <span class="section-line"></span>
        </div>
        <div style="margin-top:8px">
          ${lt(x)}
        </div>
      </div>`);let d="";if(G){k++;const h=b.map(g=>({date:R(g.date),balance:g.balance}));d=`
      <div>
        <div class="section-header">
          <span class="section-num">${k}</span>
          <span class="section-name">Balance over time</span>
          <span class="section-line"></span>
        </div>
        <div style="margin-top:8px">
          ${rt(h)}
        </div>
      </div>`}O&&G?C.push(`
  <div class="two-col" style="margin-top:18px;align-items:flex-start">
    <div class="col">${a}</div>
    <div class="col">${d}</div>
  </div>`):C.push(`<div style="margin-top:18px">${a||d}</div>`)}if(M&&_.length>0){k++;const a=_.reduce((g,l)=>g+l.net,0),d=_.map(g=>{const l=g.net>=0?"":"–",v=g.net>=0?"positive":"negative";return`<tr>
      <td class="cat-name">${p(g.activity)}</td>
      <td class="num">${g.count}</td>
      <td class="num">${i(g.income)}</td>
      <td class="num">(${i(g.expense)})</td>
      <td class="num ${v}">${l}${i(g.net)}</td>
    </tr>`}).join(""),h=a>=0?"":"–";C.push(`
  <div class="section-header" style="margin-top:18px">
    <span class="section-num">${k}</span>
    <span class="section-name">Income &amp; expenditure by activity</span>
    <span class="section-line"></span>
  </div>
  <table class="activity-table">
    <thead><tr>
      <th>Activity</th>
      <th class="r">Count</th>
      <th class="r">Income (£)</th>
      <th class="r">Expenditure (£)</th>
      <th class="r">Net (£)</th>
    </tr></thead>
    <tbody>
      ${d}
      <tr class="total-row">
        <td><strong>Total</strong></td>
        <td class="num"><strong>${z.length}</strong></td>
        <td class="num"><strong>${i(s)}</strong></td>
        <td class="num"><strong>(${i(D)})</strong></td>
        <td class="num"><strong>${h}${i(a)}</strong></td>
      </tr>
    </tbody>
  </table>`)}const E=U(A.filter(a=>a.status==="pending")),W=$&&$.length>0;if(E.length>0||W){let a="";if(E.length>0){k++;const h=E.reduce((v,F)=>{const w=parseFloat(F.amount)||0;return v+(F.type==="income"?w:-w)},0),g=E.map(v=>{const F=parseFloat(v.amount)||0,w=v.type==="expense";return`<tr>
        <td>${p(R(v.date))}</td>
        <td>${p(v.description)}</td>
        <td class="num">${w?`(${i(F)})`:i(F)}</td>
      </tr>`}).join(""),l=h>=0?"":"–";a=`
      <div class="section-header">
        <span class="section-num">${k}</span>
        <span class="section-name">Pending transactions</span>
        <span class="section-line"></span>
      </div>
      <table class="mini-table">
        <thead><tr>
          <th>Date</th>
          <th>Description</th>
          <th class="r">Amount (£)</th>
        </tr></thead>
        <tbody>
          ${g}
          <tr class="total-row">
            <td colspan="2"><strong>Net pending</strong></td>
            <td class="num"><strong>${l}${i(Math.abs(h))}</strong></td>
          </tr>
        </tbody>
      </table>
      <p class="mini-note">${E.length} transaction${E.length!==1?"s":""} awaiting approval</p>`}let d="";if(W){k++;const h=$.filter(w=>w.type==="income").reduce((w,j)=>w+(parseFloat(j.amount)||0),0),g=$.filter(w=>w.type==="expense").reduce((w,j)=>w+(parseFloat(j.amount)||0),0),l=h-g,v=$.map(w=>{const j=parseFloat(w.amount)||0,tt=w.type==="expense";return`<tr>
        <td>${p(R(w.date))}</td>
        <td>${p(w.description)}</td>
        <td class="num">${tt?`(${i(j)})`:i(j)}</td>
      </tr>`}).join(""),F=l>=0?"":"–";d=`
      <div class="section-header">
        <span class="section-num">${k}</span>
        <span class="section-name">Upcoming planned</span>
        <span class="section-line"></span>
      </div>
      <table class="mini-table">
        <thead><tr>
          <th>Due</th>
          <th>Description</th>
          <th class="r">Amount (£)</th>
        </tr></thead>
        <tbody>
          ${v}
          <tr class="total-row">
            <td colspan="2"><strong>Net planned</strong></td>
            <td class="num"><strong>${F}${i(Math.abs(l))}</strong></td>
          </tr>
        </tbody>
      </table>
      <p class="mini-note">${$.length} upcoming transaction${$.length!==1?"s":""}</p>`}E.length>0&&W?C.push(`
  <div class="two-col" style="margin-top:18px;align-items:flex-start">
    <div class="col">${a}</div>
    <div class="col">${d}</div>
  </div>`):C.push(`<div style="margin-top:18px">${a||d}</div>`)}if(C.push(`
  <div class="footnotes">
    <hr class="sep">
    <p class="disclaimer">Outflows shown in parentheses. Share percentages are of their respective totals and may not sum to 100% due to rounding. Report includes transactions with status <em>Approved</em> or <em>Auto</em> only. <em>Pending</em> and <em>Rejected</em> transactions are excluded.</p>
  </div>`),T&&z.length>0){k++;const d=[...z].reverse().map(h=>{const g=parseFloat(h.amount)||0,l=h.type==="expense",v=Y.get(h.id)??0;return`<tr>
      <td class="date">${p(R(h.date))}</td>
      <td>${p(h.description)}</td>
      <td>${p(h.category||"—")}</td>
      <td>${p(h.party||"—")}</td>
      <td>${p(at(h.status))}</td>
      <td class="num">${l?`(${i(g)})`:i(g)}</td>
      <td class="num">${i(v)}</td>
    </tr>`}).join("");C.push(`
  <div class="page-break"></div>
  <div class="section-header">
    <span class="section-num">${k}</span>
    <span class="section-name">Transaction register</span>
    <span class="section-line"></span>
  </div>
  <table class="register">
    <thead><tr>
      <th>Date</th>
      <th>Description</th>
      <th>Category</th>
      <th>Party</th>
      <th>Status</th>
      <th class="r">Amount (£)</th>
      <th class="r">Balance (£)</th>
    </tr></thead>
    <tbody>${d}</tbody>
  </table>`)}const Q=o?`<div class="org-name">${p(o.toUpperCase())}</div>`:"",Z=r?`<div><span class="meta-label">Sheet</span> ${p(r)}</div>`:"";return`<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@300;400;500;600&display=swap" rel="stylesheet">
<style>
@page { size: A4; margin: 18mm 15mm 22mm; }
* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  font-family: 'IBM Plex Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: 9pt;
  color: #1e293b;
  line-height: 1.5;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
  padding-bottom: 14mm;
}

/* --- Page break --- */
.page-break {
  page-break-before: always;
  break-before: page;
  height: 0;
  margin: 0;
  padding: 0;
}

/* --- Header --- */
.header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 16px;
}
.header-left {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}
.logo-img {
  width: 38px;
  height: 38px;
  flex-shrink: 0;
  margin-top: 2px;
}
.org-name {
  font-family: 'DM Sans', sans-serif;
  font-size: 8pt;
  font-weight: 600;
  letter-spacing: 0.4px;
  text-transform: uppercase;
  color: #64748b;
  margin-bottom: 1px;
}
.report-title {
  font-family: 'DM Sans', sans-serif;
  font-size: 20pt;
  font-weight: 700;
  color: #1e293b;
  line-height: 1.15;
}
.header-right {
  text-align: right;
  font-size: 8.5pt;
  color: #64748b;
  line-height: 1.7;
  padding-top: 2px;
}
.meta-label {
  font-weight: 600;
  color: #1e293b;
}

/* --- Summary band --- */
.summary-band {
  background: #f5f6f8;
  border-radius: 8px;
  padding: 18px 24px;
  display: flex;
  gap: 24px;
  margin-bottom: 22px;
}
.metric { flex: 1; }
.metric-label {
  font-size: 7pt;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: #64748b;
  margin-bottom: 4px;
}
.metric-value {
  font-family: 'IBM Plex Mono', 'Courier New', monospace;
  font-size: 15pt;
  font-weight: 600;
  color: #1e293b;
  line-height: 1.2;
  white-space: nowrap;
}
.metric-value.positive { color: #2D8A6E; }
.metric-value.negative { color: #C0392B; }
.metric-sub {
  font-size: 8pt;
  color: #94a3b8;
  margin-top: 3px;
}

/* --- Section headers --- */
.section-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}
.section-num {
  font-family: 'DM Sans', sans-serif;
  font-size: 13pt;
  font-weight: 700;
  color: #1e293b;
}
.section-name {
  font-family: 'DM Sans', sans-serif;
  font-size: 13pt;
  font-weight: 700;
  color: #1e293b;
  white-space: nowrap;
}
.section-line {
  flex: 1;
  height: 1px;
  background: #d1d5db;
}

/* --- Page-break avoidance for sections --- */
.two-col,
.activity-table,
.mini-table {
  break-inside: avoid;
  page-break-inside: avoid;
}
.section-header {
  break-after: avoid;
  page-break-after: avoid;
}

/* --- Two-column layout --- */
.two-col {
  display: flex;
  gap: 20px;
  margin-bottom: 4px;
}
.two-col .col { flex: 1; }

/* --- Breakdown tables (Income / Expenditure) --- */
.breakdown {
  width: 100%;
  border-collapse: collapse;
  margin: 0 0 8px;
}
.breakdown thead th {
  font-size: 7pt;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  color: #64748b;
  padding: 0 6px 6px;
  border-bottom: 1.5px solid #d1d5db;
  text-align: left;
  background: none;
}
.breakdown thead th:first-child { padding-left: 0; }
.breakdown thead th.r { text-align: right; }
.breakdown tbody td {
  padding: 5px 6px;
  border-bottom: 1px solid #f0f0f0;
  font-size: 8.5pt;
}
.breakdown tbody td:first-child { padding-left: 0; }
.breakdown .cat-name { font-weight: 600; }
.breakdown .sub-item td:first-child { padding-left: 16px; }
.breakdown .sub-item td {
  color: #64748b;
  font-size: 8pt;
  border-bottom-color: #f8f8f8;
  padding-top: 3px;
  padding-bottom: 3px;
}
.sub-count {
  font-size: 7pt;
  color: #94a3b8;
}
.breakdown .total-row td {
  border-top: 1.5px solid #d1d5db;
  border-bottom: none;
  padding-top: 7px;
  font-weight: 600;
  background: none;
}
.breakdown td.num,
.breakdown .total-row td.num {
  font-family: 'IBM Plex Mono', 'Courier New', monospace;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.share {
  text-align: right;
  white-space: nowrap;
  font-size: 8pt;
  color: #64748b;
}
.bar {
  display: inline-block;
  height: 9px;
  border-radius: 4.5px;
  vertical-align: middle;
  margin-right: 4px;
}
.income-bar { background: #89B0AE; }
.expense-bar { background: #C07A72; }

/* --- Activity table --- */
.activity-table {
  width: 100%;
  border-collapse: collapse;
  margin: 0 0 8px;
}
.activity-table thead th {
  font-size: 7pt;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  color: #64748b;
  padding: 0 6px 6px;
  border-bottom: 1.5px solid #d1d5db;
  text-align: left;
  background: none;
}
.activity-table thead th:first-child { padding-left: 0; }
.activity-table thead th.r { text-align: right; }
.activity-table tbody td {
  padding: 5px 6px;
  border-bottom: 1px solid #f0f0f0;
  font-size: 8.5pt;
}
.activity-table tbody td:first-child { padding-left: 0; }
.activity-table .cat-name { font-weight: 600; }
.activity-table td.num {
  font-family: 'IBM Plex Mono', 'Courier New', monospace;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.activity-table td.positive { color: #2D8A6E; }
.activity-table td.negative { color: #C0392B; }
.activity-table .total-row td {
  border-top: 1.5px solid #d1d5db;
  border-bottom: none;
  padding-top: 7px;
  font-weight: 600;
  background: none;
}

/* --- Transaction register --- */
.register {
  width: 100%;
  border-collapse: collapse;
  margin: 0 0 6px;
}
.register thead th {
  font-size: 7pt;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  color: #64748b;
  padding: 6px 8px;
  border-bottom: 2px solid #89B0AE;
  text-align: left;
  background: none;
}
.register thead th.r { text-align: right; }
.register tbody td {
  padding: 7px 8px;
  border-bottom: 1px solid #f0f0f0;
  font-size: 8.5pt;
  vertical-align: top;
}
.register td.date { white-space: nowrap; color: #64748b; }
.register td.num {
  font-family: 'IBM Plex Mono', 'Courier New', monospace;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

/* --- Footnotes --- */
.sep {
  border: none;
  border-top: 1px solid #e2e8f0;
  margin: 20px 0 10px;
}
.disclaimer {
  font-size: 7.5pt;
  color: #64748b;
  line-height: 1.55;
}

/* --- Mini tables (Pending / Planned) --- */
.mini-table {
  width: 100%;
  border-collapse: collapse;
  margin: 0 0 6px;
}
.mini-table thead th {
  font-size: 7pt;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  color: #64748b;
  padding: 0 6px 6px;
  border-bottom: 1.5px solid #d1d5db;
  text-align: left;
  background: none;
}
.mini-table thead th:first-child { padding-left: 0; }
.mini-table thead th.r { text-align: right; }
.mini-table tbody td {
  padding: 4px 6px;
  border-bottom: 1px solid #f0f0f0;
  font-size: 8.5pt;
}
.mini-table tbody td:first-child { padding-left: 0; }
.mini-table td.num {
  font-family: 'IBM Plex Mono', 'Courier New', monospace;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.mini-table .total-row td {
  border-top: 1.5px solid #d1d5db;
  border-bottom: none;
  padding-top: 6px;
  font-weight: 600;
  background: none;
}
.mini-note {
  font-size: 7.5pt;
  color: #94a3b8;
  margin-top: 4px;
  font-style: italic;
}

</style>
</head>
<body>
  <header class="header">
    <div class="header-left">
      <div class="logo-img">${it}</div>
      <div>
        ${Q}
        <div class="report-title">Financial summary</div>
      </div>
    </div>
    <div class="header-right">
      <div><span class="meta-label">Period</span> ${p(J)}</div>
      ${Z}
      <div><span class="meta-label">FY</span> ${p(K)}</div>
    </div>
  </header>
  ${C.join(`
`)}
</body>
</html>`}export{ct as renderReportHTML};
