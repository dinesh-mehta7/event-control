// Styles for the sign-in screen. Kept as a string and injected by AuthScreen so the screen
// always looks the same (dark, saffron + gold) regardless of the app's light/dark setting.
export const AUTH_CSS = String.raw`
@property --ea-ang { syntax: "<angle>"; inherits: false; initial-value: 0deg; }
.ea{
  --bg:#0d0e11; --card:rgba(20,21,26,.78); --line:rgba(255,255,255,.08); --line-2:rgba(255,255,255,.14);
  --text:#eef0f5; --muted:#9097a6; --dim:#626a7a; --saffron:#ff8a1f; --gold:#ffc23d; --indigo:#5b54f0;
  --ok:#33d17a; --err:#ff5d6c; --ease:cubic-bezier(.2,.8,.2,1); --spring:cubic-bezier(.34,1.56,.64,1);
  --w:255,140,40; --w2:255,190,90; --pale:#ffd9a8; --acc-text:#ffb35c; --on-acc:#1a1206;
  --b1:#ffcf55; --b2:#ff9a2a; --b3:#ff6a1f; --flash-mid:#d4500f; --flash-end:#120a06;
  position:fixed; inset:0; overflow-x:hidden; overflow-y:auto; background:var(--bg); color:var(--text);
  font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif; -webkit-font-smoothing:antialiased; z-index:40;
}
.ea *,.ea *::before,.ea *::after{box-sizing:border-box}
.ea button,.ea input{font:inherit;color:inherit}

/* Dark theme: the same page in the app's indigo (the emblem keeps its own colours). */
.ea.indigo{
  --saffron:#6366f1; --gold:#a3aafb; --w:110,118,245; --w2:163,170,251; --pale:#c7cdfe; --acc-text:#a3aafb; --on-acc:#ffffff;
  --b1:#9aa1ff; --b2:#6f74f5; --b3:#4f46e5; --flash-mid:#3730a3; --flash-end:#0b0b1a;
}
/* background */
.ea-bg{position:fixed;inset:0;z-index:0;overflow:hidden;pointer-events:none}
.ea-bg::before{content:"";position:absolute;left:50%;top:55%;width:120vmax;height:120vmax;transform:translate(-50%,-50%);
  background:radial-gradient(closest-side,rgba(70,60,190,.22),rgba(70,60,190,.07) 45%,transparent 70%);animation:ea-breathe 9s ease-in-out infinite}
.ea-bg::after{content:"";position:absolute;left:50%;top:22%;width:70vmax;height:70vmax;transform:translate(-50%,-50%);
  background:radial-gradient(closest-side,rgba(var(--w),.16),rgba(var(--w),.05) 50%,transparent 72%);
  opacity:0;animation:ea-fadeIn 2.4s .4s ease forwards, ea-breathe 7s 2.8s ease-in-out infinite}
.ea-grid{position:absolute;inset:-2px;
  background-image:linear-gradient(rgba(255,255,255,.028) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.028) 1px,transparent 1px);
  background-size:56px 56px;-webkit-mask-image:radial-gradient(ellipse at 50% 45%,#000 10%,transparent 65%);mask-image:radial-gradient(ellipse at 50% 45%,#000 10%,transparent 65%);
  opacity:0;animation:ea-fadeIn 3s 1s ease forwards}
.ea-embers{position:absolute;inset:0;width:100%;height:100%}
.ea-vignette{position:absolute;inset:0;background:radial-gradient(ellipse at center,transparent 50%,rgba(0,0,0,.55))}

.ea-main{position:relative;z-index:1;min-height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:40px 16px 48px;transition:opacity .6s var(--ease),filter .6s}

/* emblem */
.ea-emblem{position:relative;width:min(200px,48vw);aspect-ratio:290/253;margin-bottom:-6px;z-index:2;transform-style:preserve-3d;transition:transform .6s var(--ease);will-change:transform}
.ea-halo{position:absolute;left:50%;top:44%;width:175%;aspect-ratio:1;transform:translate(-50%,-50%) scale(.3);border-radius:50%;
  background:repeating-conic-gradient(from 0deg,rgba(var(--w),.22) 0deg 2.2deg,transparent 2.2deg 10deg);
  -webkit-mask-image:radial-gradient(circle,transparent 26%,#000 34%,rgba(0,0,0,.6) 48%,transparent 68%);mask-image:radial-gradient(circle,transparent 26%,#000 34%,rgba(0,0,0,.6) 48%,transparent 68%);
  opacity:0;animation:ea-haloIn 1.6s .5s var(--ease) forwards, ea-spin 60s 2.1s linear infinite}
.ea-halo.b{width:140%;background:repeating-conic-gradient(from 5deg,rgba(var(--w2),.14) 0deg 1deg,transparent 1deg 6deg);animation:ea-haloIn 1.6s .7s var(--ease) forwards, ea-spinR 90s 2.3s linear infinite}
.ea-glow{position:absolute;left:50%;top:46%;width:95%;aspect-ratio:1;border-radius:50%;transform:translate(-50%,-50%);
  background:radial-gradient(circle,rgba(var(--w),.45),rgba(var(--w),.12) 45%,transparent 70%);filter:blur(10px);opacity:0;
  animation:ea-fadeIn 1.2s .6s ease forwards, ea-pulse 4s 2s ease-in-out infinite}
.ea-logo{position:relative;width:100%;height:100%;display:grid;place-items:center;opacity:0;transform:scale(.6) translateY(24px);animation:ea-logoIn 1.4s .35s var(--spring) forwards}
.ea-logo img{width:100%;height:100%;object-fit:contain;display:block;filter:drop-shadow(0 10px 30px rgba(var(--w),.25));user-select:none;-webkit-user-drag:none;transition:filter .8s}
.ea-logo svg{width:62%;height:auto;filter:drop-shadow(0 10px 30px rgba(var(--w),.35))}
.ea-flame{position:absolute;left:50%;top:58%;width:20%;height:40%;transform:translate(-50%,-50%);border-radius:50% 50% 45% 45%;
  background:radial-gradient(ellipse at 50% 65%,rgba(var(--w2),.75),rgba(var(--w),.25) 45%,transparent 70%);
  mix-blend-mode:screen;filter:blur(6px);opacity:0;animation:ea-fadeIn .8s 1.5s forwards, ea-flicker 2.6s 1.5s infinite}
.ea-shine{position:absolute;inset:0;pointer-events:none;background:linear-gradient(105deg,transparent 35%,rgba(255,255,255,.55) 50%,transparent 65%);
  background-size:250% 100%;background-position:150% 0;-webkit-mask:var(--logo) center/contain no-repeat;mask:var(--logo) center/contain no-repeat;animation:ea-sweep 1.4s 1.7s ease-in-out forwards}

/* title */
.ea-brand{text-align:center;margin:10px 0 22px;position:relative;z-index:2;transition:opacity .6s var(--ease),transform .6s var(--ease),filter .6s}
.ea-brand h1{margin:0;font-family:Sora,Inter,sans-serif;font-weight:700;font-size:clamp(26px,4.4vw,32px);letter-spacing:-.02em;display:flex;justify-content:center;flex-wrap:wrap;perspective:400px}
.ea-brand h1 span{display:inline-block;opacity:0;transform:translateY(18px) rotateX(-70deg);animation:ea-letterIn .8s var(--spring) forwards;animation-delay:calc(1.05s + var(--i) * 38ms);
  background:linear-gradient(180deg,#fff 30%,var(--pale));-webkit-background-clip:text;background-clip:text;color:transparent}
.ea-brand h1 .sp{width:.3em}
.ea-brand p{margin:6px 0 0;color:var(--muted);font-size:13.5px;letter-spacing:.02em;opacity:0;animation:ea-rise .8s 1.65s var(--ease) forwards}
.ea-brand p b{color:var(--acc-text);font-weight:500}

/* card */
.ea-card{position:relative;width:100%;max-width:440px;border-radius:22px;padding:28px 30px 26px;
  background:linear-gradient(var(--card),var(--card)) padding-box,
    conic-gradient(from var(--ea-ang),rgba(255,255,255,.07) 0deg,rgba(var(--w),.55) 40deg,rgba(var(--w2),.7) 60deg,rgba(255,255,255,.07) 100deg,rgba(255,255,255,.07) 200deg,rgba(91,84,240,.55) 250deg,rgba(255,255,255,.07) 300deg) border-box;
  border:1px solid transparent;backdrop-filter:blur(18px) saturate(140%);-webkit-backdrop-filter:blur(18px) saturate(140%);
  box-shadow:0 30px 80px -20px rgba(0,0,0,.7),0 0 0 1px rgba(0,0,0,.2),inset 0 1px 0 rgba(255,255,255,.04);
  opacity:0;transform:translateY(40px) scale(.96);animation:ea-cardIn 1s 1.35s var(--ease) forwards, ea-borderSpin 8s linear infinite}
.ea-card::before{content:"";position:absolute;inset:0;border-radius:inherit;pointer-events:none;background:radial-gradient(360px circle at var(--mx,50%) var(--my,0%),rgba(var(--w),.07),transparent 60%)}

.ea-tabs{position:relative;display:grid;grid-template-columns:1fr 1fr;background:rgba(255,255,255,.035);border:1px solid var(--line);border-radius:12px;padding:4px;margin-bottom:24px;max-height:60px;
  transition:opacity .4s var(--ease),transform .4s var(--ease),max-height .5s var(--ease),margin .5s var(--ease),padding .5s var(--ease),border-color .4s}
.ea-tabs.hide{opacity:0;transform:translateY(-8px) scale(.97);max-height:0;margin-bottom:0;padding:0 4px;border-color:transparent;pointer-events:none}
.ea-tabs button{position:relative;z-index:1;background:none;border:0;cursor:pointer;padding:9px 0;font-size:13.5px;font-weight:600;color:var(--muted);transition:color .35s}
.ea-tabs button[aria-selected="true"]{color:var(--on-acc)}
.ea-pill{position:absolute;top:4px;bottom:4px;left:4px;width:calc(50% - 4px);border-radius:9px;background:linear-gradient(135deg,var(--gold),var(--saffron));box-shadow:0 6px 20px -6px rgba(var(--w),.7);transition:transform .55s var(--spring)}
.ea-tabs[data-at="signup"] .ea-pill{transform:translateX(100%)}

.ea-stage{position:relative;transition:height .55s var(--ease)}
.ea-view{position:absolute;inset:0 0 auto 0;visibility:hidden;pointer-events:none}
.ea-view.active{visibility:visible;pointer-events:auto}
.ea-view.leaving{visibility:visible}
.ea-view .ea-f{opacity:0}
.ea-view.active .ea-f{animation:ea-fIn .65s var(--ease) both;animation-delay:calc(var(--i) * 55ms + 120ms)}
.ea-view.leaving .ea-f{animation:ea-fOut .32s ease-in both;animation-delay:calc(var(--i) * 22ms)}
.ea-card.boot .ea-view.active .ea-f{animation-delay:calc(var(--i) * 70ms + 1.75s)}

.ea-head{margin-bottom:18px}
.ea-head h2{margin:0;font-family:Sora,Inter,sans-serif;font-size:19px;font-weight:600;letter-spacing:-.01em}
.ea-head p{margin:4px 0 0;color:var(--muted);font-size:13.5px;line-height:1.5}

/* fields */
.ea-field{position:relative;margin-bottom:14px;min-width:0}
.ea-box{position:relative;display:flex;align-items:center;height:54px;background:rgba(0,0,0,.28);border:1px solid var(--line);border-radius:12px;transition:border-color .3s,background .3s,box-shadow .3s;overflow:hidden}
.ea-box::after{content:"";position:absolute;left:0;right:0;bottom:0;height:2px;background:linear-gradient(90deg,transparent,var(--saffron),var(--gold),transparent);transform:scaleX(0);transition:transform .5s var(--ease)}
.ea-box:focus-within{border-color:rgba(var(--w),.55);background:rgba(var(--w),.04);box-shadow:0 0 0 4px rgba(var(--w),.1)}
.ea-box:focus-within::after{transform:scaleX(1)}
.ea-ico{width:46px;flex:none;display:grid;place-items:center;color:var(--dim);transition:color .3s,transform .4s var(--spring)}
.ea-box:focus-within .ea-ico{color:var(--gold);transform:scale(1.12)}
.ea-ico svg{width:18px;height:18px}
.ea-box input{flex:1;min-width:0;width:100%;height:100%;background:none;border:0;outline:0;padding:18px 12px 0 0;font-size:15px}
.ea-box input:-webkit-autofill{-webkit-text-fill-color:var(--text);transition:background-color 9999s}
.ea-box label{position:absolute;left:46px;top:50%;transform:translateY(-50%);color:var(--dim);font-size:14px;pointer-events:none;transform-origin:left center;transition:transform .3s var(--ease),color .3s,top .3s var(--ease)}
.ea-box input:focus + label,.ea-box input:not(:placeholder-shown) + label,.ea-box input:-webkit-autofill + label{top:15px;transform:translateY(-50%) scale(.76);color:var(--muted);letter-spacing:.06em;text-transform:uppercase;font-weight:600}
.ea-box input:focus + label{color:var(--acc-text)}
.ea-box input::placeholder{color:transparent}
.ea-box input.upper{text-transform:uppercase;letter-spacing:.14em}
.ea-trail{flex:none;display:flex;align-items:center;padding-right:8px}
.ea-eye{width:38px;height:38px;border-radius:9px;background:none;border:0;cursor:pointer;color:var(--dim);display:grid;place-items:center;transition:color .25s,background .25s}
.ea-eye:hover{color:var(--text);background:rgba(255,255,255,.05)}
.ea-eye svg{width:20px;height:20px;overflow:visible}
.ea-eye .lid{transform-origin:12px 12px;transition:transform .35s var(--ease)}
.ea-eye .slash{stroke-dasharray:24;stroke-dashoffset:24;transition:stroke-dashoffset .35s var(--ease)}
.ea-eye[aria-pressed="false"] .slash{stroke-dashoffset:0}
.ea-eye.blink .lid{animation:ea-blink .35s ease}
.ea-msg{font-size:12px;color:var(--err);height:0;overflow:hidden;opacity:0;transition:height .3s var(--ease),opacity .3s,margin .3s}
.ea-field.bad .ea-box{border-color:rgba(255,93,108,.6);box-shadow:0 0 0 4px rgba(255,93,108,.1)}
.ea-field.bad .ea-ico{color:var(--err)}
.ea-field.bad .ea-msg{height:18px;opacity:1;margin-top:6px}
.ea-field.good .ea-ico{color:var(--ok)}
.ea-shake{animation:ea-shake .45s cubic-bezier(.36,.07,.19,.97)}
.ea-hint{font-size:12px;color:var(--dim);margin:-6px 2px 14px;line-height:1.45}
.ea-row2{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px}

/* organisation choice on sign-up */
.ea-seg{position:relative;display:grid;grid-template-columns:1fr 1fr;gap:0;background:rgba(255,255,255,.035);border:1px solid var(--line);border-radius:12px;padding:4px;margin-bottom:14px}
.ea-seg button{position:relative;z-index:1;background:none;border:0;cursor:pointer;padding:8px 0;font-size:12.5px;font-weight:600;color:var(--muted);transition:color .35s;display:flex;align-items:center;justify-content:center;gap:6px}
.ea-seg button svg{width:15px;height:15px}
.ea-seg button[aria-pressed="true"]{color:var(--text)}
.ea-seg .ea-segpill{position:absolute;top:4px;bottom:4px;left:4px;width:calc(50% - 4px);border-radius:9px;background:rgba(var(--w),.14);border:1px solid rgba(var(--w),.45);transition:transform .5s var(--spring)}
.ea-seg[data-at="join"] .ea-segpill{transform:translateX(100%)}

/* strength */
.ea-strength{display:flex;gap:6px;margin:-4px 2px 14px;align-items:center}
.ea-strength i{flex:1;height:4px;border-radius:4px;background:rgba(255,255,255,.08);position:relative;overflow:hidden}
.ea-strength i::after{content:"";position:absolute;inset:0;background:var(--c,#555);transform:scaleX(0);transform-origin:left;transition:transform .45s var(--ease),background .3s}
.ea-strength i.on::after{transform:scaleX(1)}
.ea-strength span{font-size:11.5px;color:var(--muted);width:62px;text-align:right;transition:color .3s}

.ea-util{display:flex;align-items:center;justify-content:space-between;margin:4px 0 20px;font-size:13px}
.ea-check{display:flex;align-items:center;gap:9px;cursor:pointer;color:var(--muted);user-select:none}
.ea-check input{position:absolute;opacity:0;pointer-events:none}
.ea-check .bx{width:18px;height:18px;border-radius:6px;border:1.5px solid var(--line-2);display:grid;place-items:center;transition:background .25s,border-color .25s,transform .3s var(--spring)}
.ea-check .bx svg{width:12px;height:12px;stroke:var(--on-acc);stroke-width:3;fill:none;stroke-dasharray:16;stroke-dashoffset:16;transition:stroke-dashoffset .35s .05s var(--ease)}
.ea-check input:checked + .bx{background:linear-gradient(135deg,var(--gold),var(--saffron));border-color:transparent;transform:scale(1.08)}
.ea-check input:checked + .bx svg{stroke-dashoffset:0}
.ea-check input:focus-visible + .bx{box-shadow:0 0 0 3px rgba(var(--w),.35)}
.ea-link{background:none;border:0;cursor:pointer;color:var(--acc-text);font-weight:600;font-size:13px;position:relative;padding:2px 0}
.ea-link::after{content:"";position:absolute;left:0;right:0;bottom:0;height:1px;background:currentColor;transform:scaleX(0);transform-origin:right;transition:transform .35s var(--ease)}
.ea-link:hover::after{transform:scaleX(1);transform-origin:left}
.ea-link:focus-visible{outline:2px solid var(--gold);outline-offset:3px;border-radius:3px}

/* primary button */
.ea-btn{position:relative;width:100%;height:52px;border:0;border-radius:13px;cursor:pointer;overflow:hidden;font-family:Sora,Inter,sans-serif;font-weight:600;font-size:15px;color:var(--on-acc);
  background:linear-gradient(135deg,var(--b1),var(--b2) 50%,var(--b3));background-size:180% 180%;background-position:0% 50%;
  box-shadow:0 12px 30px -10px rgba(var(--w),.75),inset 0 1px 0 rgba(255,255,255,.4);
  transition:transform .3s var(--spring),box-shadow .3s,background-position .6s var(--ease);display:flex;align-items:center;justify-content:center;gap:8px}
.ea-btn:hover{transform:translateY(-2px);background-position:100% 50%;box-shadow:0 18px 40px -12px rgba(var(--w),.9),inset 0 1px 0 rgba(255,255,255,.4)}
.ea-btn:active{transform:translateY(0) scale(.985)}
.ea-btn:focus-visible{outline:2px solid var(--gold);outline-offset:3px}
.ea-btn::before{content:"";position:absolute;top:0;bottom:0;width:40%;left:-60%;background:linear-gradient(100deg,transparent,rgba(255,255,255,.55),transparent);transform:skewX(-20deg);animation:ea-shimmer 4.5s 3s ease-in-out infinite}
.ea-btn .lbl,.ea-btn .arrow{position:relative;transition:transform .35s var(--ease),opacity .25s}
.ea-btn:hover .arrow{transform:translateX(4px)}
.ea-btn .arrow{width:16px;height:16px}
.ea-btn .spin{position:absolute;width:22px;height:22px;border-radius:50%;border:2.5px solid rgba(26,18,6,.25);border-top-color:var(--on-acc);opacity:0;transform:scale(.4);transition:opacity .25s,transform .35s var(--spring)}
.ea-btn.loading{pointer-events:none}
.ea-btn.loading .lbl,.ea-btn.loading .arrow{opacity:0;transform:translateY(-12px)}
.ea-btn.loading .spin{opacity:1;transform:scale(1);animation:ea-rot .7s linear infinite}
.ea-ripple{position:absolute;border-radius:50%;background:rgba(255,255,255,.55);transform:scale(0);animation:ea-ripple .7s ease-out forwards;pointer-events:none}

.ea-foot{margin-top:20px;padding-top:18px;border-top:1px solid var(--line);text-align:center;font-size:13px;color:var(--muted)}
.ea-foot small{display:block;margin-top:10px;color:var(--dim);font-size:12px;line-height:1.55}
.ea-back{display:inline-flex;align-items:center;gap:6px;background:none;border:0;cursor:pointer;color:var(--muted);font-size:13px;margin-bottom:14px;padding:0;transition:color .25s}
.ea-back:hover{color:var(--text)}
.ea-back svg{width:16px;height:16px;transition:transform .35s var(--ease)}
.ea-back:hover svg{transform:translateX(-4px)}

/* banners */
.ea-formerr,.ea-notice{display:flex;align-items:flex-start;gap:9px;font-size:13px;border-radius:11px;padding:0 12px;max-height:0;opacity:0;margin:0;overflow:hidden;transform:translateY(-6px);line-height:1.45;
  transition:max-height .4s var(--ease),opacity .3s,margin .4s var(--ease),padding .4s var(--ease),transform .4s var(--ease)}
.ea-formerr{color:#ffc2c8;background:rgba(255,93,108,.09);border:1px solid rgba(255,93,108,.28)}
.ea-notice{color:var(--pale);background:rgba(var(--w),.08);border:1px solid rgba(var(--w),.3)}
.ea-formerr svg,.ea-notice svg{width:17px;height:17px;flex:none;margin-top:1px}
.ea-formerr svg{color:var(--err)} .ea-notice svg{color:var(--gold)}
.ea-formerr.show,.ea-notice.show{max-height:120px;opacity:1;padding:10px 12px;margin:-6px 0 16px;transform:none}
.ea-notice button{display:block;margin-top:4px;background:none;border:0;padding:0;color:var(--gold);font-weight:600;text-decoration:underline;text-underline-offset:2px;cursor:pointer;font-size:12.5px}

.ea-demo{margin-top:14px;display:flex;flex-direction:column;align-items:center;gap:8px}
.ea-demo-k{font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--dim);font-weight:600}
.ea-chips{display:flex;flex-wrap:wrap;justify-content:center;gap:6px}
.ea-chip{display:inline-flex;align-items:center;gap:6px;cursor:pointer;background:rgba(255,255,255,.035);border:1px solid var(--line);border-radius:999px;padding:5px 11px 5px 7px;font-size:12px;color:var(--muted);
  transition:border-color .25s,color .25s,background .25s,transform .3s var(--spring)}
.ea-chip:hover{border-color:rgba(var(--w),.5);color:var(--text);background:rgba(var(--w),.07);transform:translateY(-2px)}
.ea-chip i{width:8px;height:8px;border-radius:50%;background:var(--c);box-shadow:0 0 8px var(--c)}
.ea-chip.typing{border-color:rgba(var(--w),.7);color:var(--pale)}

.ea-copy{position:relative;z-index:1;margin-top:22px;font-size:11.5px;color:var(--dim);letter-spacing:.04em;text-align:center;opacity:0;animation:ea-fadeIn 1s 2.4s forwards;transition:opacity .5s}

/* ascend: the emblem rises to centre after a successful sign-in */
.ea.ascend .ea-emblem{transition:transform 1.4s cubic-bezier(.7,0,.2,1.12);z-index:4}
.ea.ascend .ea-card{animation:ea-cardOut .75s var(--ease) forwards, ea-borderSpin 8s linear infinite;pointer-events:none}
.ea.ascend .ea-brand{opacity:0;transform:translateY(-14px) scale(.96);filter:blur(6px)}
.ea.ascend .ea-copy{opacity:0}
.ea.ascend .ea-glow{animation:ea-flare 2.6s 1.1s ease-in-out infinite}
.ea.ascend .ea-flame{animation:ea-flickerHot 1.1s infinite}
.ea.ascend .ea-logo img{filter:drop-shadow(0 0 40px rgba(var(--w),.55)) drop-shadow(0 0 90px rgba(var(--w),.35))}
.ea-fx{position:fixed;inset:0;z-index:1;pointer-events:none;visibility:hidden}
.ea.ascend .ea-fx{visibility:visible}
.ea-core{position:absolute;left:var(--cx);top:var(--cy);width:var(--D);height:var(--D);transform:translate(-50%,-50%)}
.ea-rays{position:absolute;inset:-60%;border-radius:50%;background:repeating-conic-gradient(from 0deg,rgba(var(--w2),.16) 0 1.4deg,transparent 1.4deg 7.5deg);
  -webkit-mask-image:radial-gradient(circle,transparent 12%,#000 22%,rgba(0,0,0,.35) 45%,transparent 66%);mask-image:radial-gradient(circle,transparent 12%,#000 22%,rgba(0,0,0,.35) 45%,transparent 66%);opacity:0;transform:scale(.2)}
.ea.ascend .ea-rays{animation:ea-raysIn 2s 1s var(--ease) forwards, ea-spinPlain 40s 1s linear infinite}
.ea-rays.r2{inset:-35%;background:repeating-conic-gradient(from 3deg,rgba(var(--w),.14) 0 3deg,transparent 3deg 15deg)}
.ea.ascend .ea-rays.r2{animation:ea-raysIn 2s 1.15s var(--ease) forwards, ea-spinPlainR 55s 1.15s linear infinite}
.ea-mandala{position:absolute;inset:0;width:100%;height:100%;overflow:visible}
.ea-mandala .spinA{transform-origin:200px 200px;animation:ea-spinPlain 26s linear infinite}
.ea-mandala .spinB{transform-origin:200px 200px;animation:ea-spinPlainR 38s linear infinite}
.ea-mandala .draw{fill:none;stroke-linecap:round;stroke-dasharray:var(--len);stroke-dashoffset:var(--len)}
.ea.ascend .ea-mandala .draw{animation:ea-draw 1.6s var(--ease) forwards;animation-delay:var(--d,1.1s)}
.ea-mandala .petal{fill:url(#ea-petalFill);stroke:rgba(var(--w2),.75);stroke-width:1.1;opacity:0;transform-box:fill-box;transform-origin:50% 100%;transform:scale(.2)}
.ea.ascend .ea-mandala .petal{animation:ea-petal .9s var(--spring) forwards;animation-delay:calc(1.3s + var(--i) * 50ms)}
.ea-mandala .ring2{opacity:0}
.ea.ascend .ea-mandala .ring2{animation:ea-fadeIn 1.2s 1.4s forwards}
.ea-mandala .bead{fill:var(--pale);opacity:0}
.ea.ascend .ea-mandala .bead{animation:ea-bead 2.4s ease-in-out infinite;animation-delay:calc(1.8s + var(--i) * 80ms)}
.ea-wave{position:absolute;left:50%;top:50%;width:40%;aspect-ratio:1;border-radius:50%;border:2px solid rgba(var(--w2),.8);box-shadow:0 0 30px rgba(var(--w),.5),inset 0 0 30px rgba(var(--w),.3);transform:translate(-50%,-50%) scale(.3);opacity:0}
.ea.ascend .ea-wave{animation:ea-wave 1.7s cubic-bezier(.15,.7,.3,1) forwards}
.ea.ascend .ea-wave:nth-child(3){animation-delay:1.4s}
.ea.ascend .ea-wave:nth-child(4){animation-delay:1.6s;border-color:rgba(var(--w),.6)}
.ea.ascend .ea-wave:nth-child(5){animation-delay:1.8s;border-color:rgba(120,110,255,.45);box-shadow:0 0 30px rgba(91,84,240,.35)}
.ea-welcome{position:absolute;left:50%;top:var(--ty);transform:translateX(-50%);text-align:center;width:min(92vw,560px)}
.ea-welcome h2{margin:0;font-family:Sora,Inter,sans-serif;font-weight:700;font-size:clamp(24px,4vw,34px);letter-spacing:-.02em;display:flex;justify-content:center;flex-wrap:wrap}
.ea-welcome h2 span{display:inline-block;opacity:0;transform:translateY(22px) scale(.8);filter:blur(8px);background:linear-gradient(180deg,#fff 25%,var(--pale));-webkit-background-clip:text;background-clip:text;color:transparent}
.ea-welcome h2 .sp{width:.28em}
.ea.ascend .ea-welcome h2 span{animation:ea-wIn .9s var(--spring) forwards;animation-delay:calc(1.85s + var(--i) * 38ms)}
.ea-status{margin-top:10px;height:20px;position:relative;font-size:13.5px;color:var(--muted);letter-spacing:.03em}
.ea-status span{position:absolute;inset:0;opacity:0;transform:translateY(8px);transition:opacity .35s,transform .45s var(--ease)}
.ea-status span.on{opacity:1;transform:none;transition-delay:.12s}
.ea-status span.off{opacity:0;transform:translateY(-8px);transition:opacity .18s,transform .3s var(--ease)}
.ea-status span.ok{color:var(--gold)}
.ea-track{width:220px;height:3px;margin:14px auto 0;border-radius:3px;background:rgba(255,255,255,.08);overflow:hidden;opacity:0}
.ea.ascend .ea-track{animation:ea-fadeIn .5s 2.1s forwards}
.ea-track i{display:block;height:100%;width:0;border-radius:3px;background:linear-gradient(90deg,var(--gold),var(--saffron));box-shadow:0 0 12px var(--saffron)}
.ea.ascend .ea-track i{animation:ea-fill 2.2s 2.2s cubic-bezier(.5,0,.3,1) forwards}
.ea-skip{position:fixed;right:18px;bottom:16px;z-index:5;background:rgba(255,255,255,.04);border:1px solid var(--line);color:var(--muted);border-radius:999px;padding:6px 12px;font-size:12px;cursor:pointer;opacity:0;pointer-events:none;transition:opacity .4s,color .25s}
.ea.ascend .ea-skip{opacity:1;pointer-events:auto;transition-delay:1.2s}
.ea-skip:hover{color:var(--text)}
.ea-flash{position:fixed;inset:0;z-index:20;pointer-events:none;
  background:radial-gradient(circle at var(--cx,50%) var(--cy,50%),var(--pale) 0,var(--pale) 12%,var(--b2) 30%,var(--flash-mid) 52%,var(--flash-end) 80%);
  clip-path:circle(0 at var(--cx,50%) var(--cy,50%));opacity:0}
.ea-flash.go{animation:ea-flood 1.1s cubic-bezier(.7,0,.3,1) forwards}
.ea-main.quake{animation:ea-quake .5s cubic-bezier(.36,.07,.19,.97)}

/* toast */
.ea-toast{position:fixed;left:50%;bottom:28px;z-index:30;transform:translate(-50%,30px);opacity:0;background:rgba(24,25,31,.92);border:1px solid var(--line-2);backdrop-filter:blur(10px);
  padding:11px 16px;border-radius:12px;font-size:13px;display:flex;gap:10px;align-items:center;transition:transform .5s var(--spring),opacity .35s;box-shadow:0 20px 40px -12px rgba(0,0,0,.6);pointer-events:none}
.ea-toast.show{transform:translate(-50%,0);opacity:1}
.ea-toast .dot{width:8px;height:8px;border-radius:50%;background:var(--ok);box-shadow:0 0 10px var(--ok)}

@keyframes ea-fadeIn{to{opacity:1}}
@keyframes ea-breathe{0%,100%{transform:translate(-50%,-50%) scale(1)}50%{transform:translate(-50%,-50%) scale(1.08)}}
@keyframes ea-spin{from{transform:translate(-50%,-50%) rotate(0)}to{transform:translate(-50%,-50%) rotate(360deg)}}
@keyframes ea-spinR{from{transform:translate(-50%,-50%) rotate(0)}to{transform:translate(-50%,-50%) rotate(-360deg)}}
@keyframes ea-haloIn{from{opacity:0;transform:translate(-50%,-50%) scale(.3) rotate(-90deg)}to{opacity:1;transform:translate(-50%,-50%) scale(1) rotate(0)}}
@keyframes ea-pulse{0%,100%{opacity:.75;transform:translate(-50%,-50%) scale(1)}50%{opacity:1;transform:translate(-50%,-50%) scale(1.07)}}
@keyframes ea-logoIn{0%{opacity:0;transform:scale(.6) translateY(24px);filter:blur(12px)}60%{opacity:1;filter:blur(0)}100%{opacity:1;transform:none;filter:none}}
@keyframes ea-flicker{0%,100%{opacity:.55;transform:translate(-50%,-50%) scale(1,1)}20%{opacity:.8;transform:translate(-50%,-52%) scale(.95,1.06)}40%{opacity:.5;transform:translate(-51%,-50%) scale(1.04,.97)}60%{opacity:.85;transform:translate(-49%,-53%) scale(.97,1.08)}80%{opacity:.6;transform:translate(-50%,-50%) scale(1.02,.99)}}
@keyframes ea-sweep{to{background-position:-50% 0}}
@keyframes ea-letterIn{to{opacity:1;transform:none}}
@keyframes ea-rise{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
@keyframes ea-cardIn{to{opacity:1;transform:none}}
@keyframes ea-borderSpin{to{--ea-ang:360deg}}
@keyframes ea-fIn{from{opacity:0;transform:translateX(calc(var(--dx,1) * 34px));filter:blur(6px)}to{opacity:1;transform:none;filter:blur(0)}}
@keyframes ea-fOut{from{opacity:1;transform:none;filter:blur(0)}to{opacity:0;transform:translateX(calc(var(--dx,1) * -34px));filter:blur(6px)}}
@keyframes ea-shake{10%,90%{transform:translateX(-1px)}20%,80%{transform:translateX(3px)}30%,50%,70%{transform:translateX(-6px)}40%,60%{transform:translateX(6px)}}
@keyframes ea-blink{0%,100%{transform:scaleY(1)}50%{transform:scaleY(.08)}}
@keyframes ea-shimmer{0%{left:-60%}35%,100%{left:130%}}
@keyframes ea-rot{to{transform:rotate(360deg)}}
@keyframes ea-ripple{to{transform:scale(4);opacity:0}}
@keyframes ea-draw{to{stroke-dashoffset:0}}
@keyframes ea-fill{to{width:100%}}
@keyframes ea-cardOut{from{opacity:1;transform:none;filter:blur(0)}to{opacity:0;transform:translateY(46px) scale(.9) rotateX(14deg);filter:blur(12px)}}
@keyframes ea-spinPlain{to{transform:rotate(360deg)}}
@keyframes ea-spinPlainR{to{transform:rotate(-360deg)}}
@keyframes ea-raysIn{0%{opacity:0;transform:scale(.2) rotate(-40deg)}60%{opacity:1}100%{opacity:1;transform:scale(1) rotate(0)}}
@keyframes ea-petal{to{opacity:1;transform:scale(1)}}
@keyframes ea-bead{0%,100%{opacity:.25}50%{opacity:1}}
@keyframes ea-wave{0%{opacity:0;transform:translate(-50%,-50%) scale(.3)}12%{opacity:1}100%{opacity:0;transform:translate(-50%,-50%) scale(3.4);border-width:.5px}}
@keyframes ea-wIn{to{opacity:1;transform:none;filter:blur(0)}}
@keyframes ea-flare{0%,100%{opacity:.9;transform:translate(-50%,-50%) scale(1.1)}50%{opacity:1;transform:translate(-50%,-50%) scale(1.45)}}
@keyframes ea-flickerHot{0%,100%{opacity:.85;transform:translate(-50%,-50%) scale(1.2,1.25)}25%{opacity:1;transform:translate(-50%,-55%) scale(1.1,1.45)}50%{opacity:.75;transform:translate(-52%,-50%) scale(1.3,1.15)}75%{opacity:1;transform:translate(-48%,-56%) scale(1.15,1.5)}}
@keyframes ea-quake{10%,90%{transform:translate(-1px,1px)}20%,80%{transform:translate(2px,-2px)}30%,50%,70%{transform:translate(-3px,2px)}40%,60%{transform:translate(3px,-1px)}}
@keyframes ea-flood{0%{opacity:1;clip-path:circle(0 at var(--cx) var(--cy))}100%{opacity:1;clip-path:circle(150% at var(--cx) var(--cy))}}

@media (max-width:480px){
  .ea-card{padding:22px 18px 20px;border-radius:18px}
  .ea-row2{grid-template-columns:1fr}
}
@media (prefers-reduced-motion:reduce){
  .ea *,.ea *::before,.ea *::after{animation-duration:.01ms!important;animation-delay:0s!important;animation-iteration-count:1!important;transition-duration:.01ms!important}
}
`;

// Light floods out after sign-in, then fades over the app as it appears.
export const FLASH_OUT_CSS = String.raw`
.ea-flashout{position:fixed;inset:0;z-index:80;pointer-events:none;background:radial-gradient(circle at var(--cx,50%) var(--cy,40%),#fff8e8 0,#ffd27a 12%,#ff9a2a 30%,#d4500f 52%,#120a06 80%);animation:ea-floodOut .9s ease forwards}
.ea-flashout.indigo{background:radial-gradient(circle at var(--cx,50%) var(--cy,40%),#eef0ff 0,#c7cdfe 12%,#7c83f7 30%,#3730a3 52%,#0b0b1a 80%)}
@keyframes ea-floodOut{from{opacity:1}to{opacity:0}}
@media (prefers-reduced-motion:reduce){.ea-flashout{animation-duration:.01ms}}
`;
