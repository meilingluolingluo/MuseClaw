export interface HostThemePayload {
  colorScheme: 'light' | 'dark';
  vars: Record<string, string>;
}

const THEME_VAR_FALLBACKS: Record<string, string> = {
  '--om-bg': '#ffffff',
  '--om-surface': '#ffffff',
  '--om-surface-2': '#f2f2f4',
  '--om-border': '#e7e7ea',
  '--om-fg': '#111112',
  '--om-muted': '#6b6b71',
  '--om-accent': '#0064d4',
  '--om-accent-soft': '#e5f0ff',
  '--om-accent-soft-fg': '#012f80',
  '--accent-green': '#34c759',
  '--accent-amber': '#ff9500',
  '--accent-red': '#ff3b30',
  '--font-sans': 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  '--font-mono': 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
};

export const WIDGET_MIN_HEIGHT = 120;
export const WIDGET_MAX_HEIGHT = 1200;
export const WIDGET_MAX_INTENT_LENGTH = 500;
export const WIDGET_INTENT_THROTTLE_MS = 1000;

export function clampWidgetHeight(raw: unknown, fallback = 320): number {
  const num = Number(raw);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(WIDGET_MAX_HEIGHT, Math.max(WIDGET_MIN_HEIGHT, Math.round(num)));
}

/**
 * 读取宿主页面当前的明暗模式与核心 CSS 变量，供沙箱内组件保持视觉一致
 */
export function readHostThemeVars(): HostThemePayload {
  if (typeof document === 'undefined') {
    return { colorScheme: 'light', vars: { ...THEME_VAR_FALLBACKS } };
  }
  const root = document.documentElement;
  const colorScheme: 'light' | 'dark' =
    root.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  const computed = getComputedStyle(root);
  const vars: Record<string, string> = {};
  for (const [key, fallback] of Object.entries(THEME_VAR_FALLBACKS)) {
    const val = computed.getPropertyValue(key).trim();
    vars[key] = val || fallback;
  }
  return { colorScheme, vars };
}

function buildThemeCssVars(theme: HostThemePayload): string {
  const declarations = Object.entries(theme.vars)
    .map(([k, v]) => `${k}:${v.replace(/[;{}<>]/g, '')};`)
    .join('');
  return `:root{color-scheme:${theme.colorScheme};${declarations}}`;
}

function buildBridgeScript(token: string): string {
  const safeToken = JSON.stringify(token);
  return `<script>(function(){
var T=${safeToken};
var seq=0,pending={},lastSent=0,lastH=0,errCount=0;
function applyTheme(t){
  if(!t||!t.vars)return;
  var r=document.documentElement;
  if(t.colorScheme)r.style.colorScheme=t.colorScheme;
  var ks=Object.keys(t.vars);
  for(var i=0;i<ks.length;i++){r.style.setProperty(ks[i],t.vars[ks[i]]);}
}
window.addEventListener("message",function(e){
  var d=e.data;
  if(!d||d.token!==T)return;
  if(d.type==="museclaw:widget-theme"){applyTheme(d.theme);return;}
  if(d.type==="museclaw:widget-intent-ack"&&pending[d.id]){
    var item=pending[d.id];delete pending[d.id];
    clearTimeout(item.timer);item.resolve(d.ack);
  }
});
function reportSize(){
  var de=document.documentElement,b=document.body;
  var h=Math.max(de?de.scrollHeight:0,b?b.scrollHeight:0,b?b.offsetHeight:0);
  if(h>0&&Math.abs(h-lastH)>=4){
    lastH=h;
    try{parent.postMessage({type:"museclaw:widget-size",token:T,height:h},"*");}catch(_){}
  }
}
function setupObservers(){
  reportSize();
  if(typeof ResizeObserver!=="undefined"){
    var ro=new ResizeObserver(function(){requestAnimationFrame(reportSize);});
    if(document.documentElement)ro.observe(document.documentElement);
    if(document.body)ro.observe(document.body);
  }
  if(typeof MutationObserver!=="undefined"&&document.body){
    var mo=new MutationObserver(function(){requestAnimationFrame(reportSize);});
    mo.observe(document.body,{childList:true,subtree:true,attributes:true});
  }
  if(document.fonts&&document.fonts.ready){document.fonts.ready.then(reportSize).catch(function(){});}
}
if(document.readyState==="loading"){document.addEventListener("DOMContentLoaded",setupObservers);}else{setupObservers();}
window.addEventListener("load",reportSize);
function sendIntent(prompt,opts){
  if(typeof prompt!=="string"||!prompt.trim()){return Promise.resolve({ok:false,error:"invalid"});}
  var clean=prompt.trim();
  if(clean.length>${WIDGET_MAX_INTENT_LENGTH}){return Promise.resolve({ok:false,error:"too_long",maxLength:${WIDGET_MAX_INTENT_LENGTH}});}
  if(clean.charAt(0)==="/"){return Promise.resolve({ok:false,error:"command_not_allowed"});}
  if(navigator.userActivation&&!navigator.userActivation.isActive){return Promise.resolve({ok:false,error:"requires_user_activation"});}
  var now=Date.now();
  if(now-lastSent<${WIDGET_INTENT_THROTTLE_MS}){return Promise.resolve({ok:false,error:"throttled",retryAfterMs:${WIDGET_INTENT_THROTTLE_MS}-(now-lastSent)});}
  lastSent=now;
  var id=++seq;
  return new Promise(function(resolve){
    var timer=setTimeout(function(){if(pending[id]){delete pending[id];resolve({ok:false,error:"undelivered"});}},5000);
    pending[id]={resolve:resolve,timer:timer};
    try{
      parent.postMessage({type:"museclaw:widget-intent",token:T,id:id,prompt:clean,hidden:Boolean(opts&&opts.hidden)},"*");
    }catch(_){
      clearTimeout(timer);delete pending[id];resolve({ok:false,error:"undelivered"});
    }
  });
}
window.museclaw={send:sendIntent};
document.addEventListener("click",function(e){
  var t=e.target;
  if(!t||!t.closest)return;
  var btn=t.closest("[data-muse-send]");
  if(!btn)return;
  var prompt=btn.getAttribute("data-muse-send");
  if(!prompt)return;
  var hidden=btn.getAttribute("data-muse-hidden")==="true";
  sendIntent(prompt,{hidden:hidden});
});
function reportError(msg,line,col){
  if(errCount>=3)return;
  errCount++;
  try{parent.postMessage({type:"museclaw:widget-error",token:T,message:String(msg||"Unknown error").slice(0,300),line:line,col:col},"*");}catch(_){}
}
window.addEventListener("error",function(e){reportError(e.message||(e.error&&e.error.message),e.lineno,e.colno);});
window.addEventListener("unhandledrejection",function(e){
  var r=e.reason;
  reportError(r&&r.message?r.message:String(r||"Unhandled promise rejection"));
});
})();</script>`;
}

function buildPreludeHtml(token: string, theme: HostThemePayload): string {
  const csp =
    "default-src 'none'; script-src 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://unpkg.com https://esm.sh; style-src 'unsafe-inline' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://unpkg.com; img-src https: data: blob:; font-src https: data:; connect-src 'none'; frame-src 'none'; form-action 'none';";

  const baseCss = `${buildThemeCssVars(theme)}
html,body{margin:0;padding:0;background:transparent;color:var(--om-fg);font-family:var(--font-sans);font-size:14px;line-height:1.55;-webkit-font-smoothing:antialiased;overflow-x:hidden;}
*,*::before,*::after{box-sizing:border-box;}
:where(button){font-family:inherit;font-size:13px;padding:7px 12px;border-radius:8px;border:1px solid var(--om-border);background:var(--om-surface);color:var(--om-fg);cursor:pointer;transition:background .15s,border-color .15s;}
:where(button:hover){background:var(--om-surface-2);}
:where(button.primary){background:var(--om-accent);border-color:var(--om-accent);color:#fff;}
:where(input,select,textarea){font-family:inherit;font-size:13px;padding:6px 10px;border-radius:8px;border:1px solid var(--om-border);background:var(--om-surface);color:var(--om-fg);}
:where(input[type="range"]){padding:0;accent-color:var(--om-accent);background:transparent;border:none;}
:where(table){width:100%;border-collapse:collapse;font-size:13px;}
:where(th,td){padding:8px 10px;border-bottom:1px solid var(--om-border);text-align:left;}
:where(th){color:var(--om-muted);font-weight:600;}
.museclaw-svg-stage{width:100%;display:flex;justify-content:center;align-items:center;padding:8px;}
.museclaw-svg-stage svg{max-width:100%;height:auto;display:block;}`;

  return `<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta http-equiv="Content-Security-Policy" content="${csp}" />
<style id="museclaw-theme-prelude">${baseCss}</style>
${buildBridgeScript(token)}`;
}

/**
 * 组装供隔离 iframe `srcDoc` 使用的自包含 HTML 文档，注入 CSP、宿主主题变量与通信桥
 */
export function buildWidgetSrcDoc(
  html: string,
  token: string,
  theme: HostThemePayload,
  kind?: 'html' | 'svg'
): string {
  const prelude = buildPreludeHtml(token, theme);
  const raw = String(html || '');
  const trimmed = raw.trim();
  const isSvg = kind === 'svg' || /^<svg[\s>]/i.test(trimmed);

  if (isSvg) {
    return `<!doctype html><html><head>${prelude}</head><body><div class="museclaw-svg-stage">${raw}</div></body></html>`;
  }

  const isFullDoc = /<!doctype\b|<html\b/i.test(trimmed);
  if (!isFullDoc) {
    return `<!doctype html><html><head>${prelude}</head><body>${raw}</body></html>`;
  }

  if (/<head\b[^>]*>/i.test(raw)) {
    return raw.replace(/<head\b[^>]*>/i, (match) => `${match}\n${prelude}`);
  }
  if (/<html\b[^>]*>/i.test(raw)) {
    return raw.replace(/<html\b[^>]*>/i, (match) => `${match}\n<head>${prelude}</head>`);
  }
  return `${prelude}\n${raw}`;
}
