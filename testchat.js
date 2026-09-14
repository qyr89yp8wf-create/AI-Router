// 测试抽屉：右侧拉起的对话流，供组件工作台（验证触发）与模型工作台（验证模型调用）复用。
// keepReasoning=true 时思考过程常驻展开（模型测试需要看过程）；否则回答后折叠。
window.TestChat = (function () {
  const { el } = UI;
  const TENANT = "tenant-demo";
  const USER = "demo-admin-test";

  function open(opts = {}) {
    if (document.querySelector(".drawer")) return; // 防连点开出多个抽屉
    const SESSION = "test-" + Math.random().toString(36).slice(2, 8);
    let busy = false;
    let ctrl = null;
    let lastQuestion = "";

    const msgs = el("div", { class: "tc-msgs" });
    let hint;
    if (opts.suggestions && opts.suggestions.length) {
      // 引导空态：说明 + 预设问法（点击即发送），让测试者第一眼知道能做什么
      hint = el("div", { class: "tc-guide" }, [
        el("div", { class: "tg-title" }, [opts.guideTitle || "试试这些真实场景"]),
        opts.hint ? el("div", { class: "tg-sub" }, [opts.hint]) : null,
        el("div", { class: "tg-chips" }, opts.suggestions.map(sg => el("button", { type: "button", class: "tg-chip",
          onclick: () => send(sg.text) }, [
          el("span", { class: "tg-q" }, [sg.text]),
          sg.label ? el("span", { class: "tg-l" }, [sg.label]) : null,
        ]))),
      ]);
    } else {
      hint = el("div", { class: "muted", style: "text-align:center;padding:36px 12px" },
        [opts.hint || "像用户一样提问开始测试"]);
    }
    msgs.appendChild(hint);

    // 调用方式选择：自绘分组下拉（调度策略 / 多模型 / 指定模型），不用系统默认 select
    const pickState = { kind: "policy", value: null, label: "加载中……" };
    const routeUiState = { apiId: null, costAlpha: 0.5, models: [], answer1: null, answer2: null, aggregator: null };
    let pickGroups = [];
    const pickLab = el("span", { class: "fsel-label" }, [pickState.label]);
    const modelSel = el("button", { class: "fsel tc-pick", type: "button", "aria-label": "选择调用方式" }, [pickLab, el("span", { class: "fsel-caret" }, [UI.icon("chevron", 13)])]);
    const setPick = (kind, value, label) => { pickState.kind = kind; pickState.value = value; pickState.label = label; pickLab.textContent = label; modelSel.title = label; };
    Promise.all([UI.api("/v1/policies").catch(() => ({ policies: [] })), UI.api("/v1/models").catch(() => ({ models: [] }))])
      .then(([{ policies }, { models }]) => {
        const actives = (models || []).filter(m => m.status === "active");
        pickGroups = [
          { label: "调度策略", items: (policies || []).filter(p => p.enabled && !p.ab_group).map(p => {
            const hex = String(p.policy_id).replace(/[^0-9a-f]/gi, "").slice(0, 8) || "0";
            const sid = String(parseInt(hex, 16) % 1000000).padStart(6, "0");
            return { kind: "policy", value: p.policy_id, label: p.name || p.policy_id,
              route_api_id: p.route_api_id || "route-api-default", route_api_name: p.route_api_name || "默认路由 API",
              route_type: p.route_type || (p.params || {}).route_type || "smart", model_whitelist: p.model_whitelist || [],
              allow_aggregation: !!p.allow_aggregation,
              alpha: (p.params || {}).alpha ?? 0.5, allow_cost_preference: (p.params || {}).allow_cost_effect_preference !== false,
              allow_agg_override: (p.params || {}).allow_agg_override !== false && (p.params || {}).allow_agg_override !== 0,
              default_aggregation: (p.params || {}).default_aggregation === "on" ? "on" : "off" };
          }) },
          { label: "多模型", items: [{ kind: "multi", value: null, label: "多模型回答 + 择优" }] },
          { label: "指定模型", items: actives.map(m => ({ kind: "model", value: m.model_id, label: m.display_name })) },
        ];
        routeUiState.models = actives;
        const preset = opts.model && actives.find(m => m.model_id === opts.model);
        if (preset) setPick("model", preset.model_id, preset.display_name);
        else if (pickGroups[0].items.length) {
          const f = pickGroups[0].items[0];
          setPick("policy", f.value, f.label);
          routeUiState.apiId = f.route_api_id;
          routeUiState.costAlpha = f.alpha;
          aggState.value = f.allow_aggregation ? f.default_aggregation : "off";
        }
        drawModeBar();
      });
    modelSel.onclick = () => {
      if (modelSel.disabled) return;
      document.querySelectorAll(".menu-pop").forEach(n => n.remove());
      const pop = el("div", { class: "menu-pop tc-pick-pop", role: "listbox" });
      pickGroups.forEach(g => {
        if (!g.items.length) return;
        pop.appendChild(el("div", { class: "pop-group" }, [g.label]));
        g.items.forEach(it => pop.appendChild(el("button", {
          class: "menu-item" + (pickState.kind === it.kind && pickState.value === it.value ? " on" : ""), role: "option",
          onclick: () => { pop.remove(); setPick(it.kind, it.value, it.label); },
        }, [it.label])));
      });
      document.body.appendChild(pop);
      const r = modelSel.getBoundingClientRect();
      pop.style.minWidth = Math.max(r.width, 180) + "px";
      pop.style.left = (r.left + window.scrollX) + "px";
      pop.style.top = (r.top + window.scrollY - pop.offsetHeight - 6) + "px"; // 向上展开（按钮在底部输入条）
      const close = (e) => { if (!pop.contains(e.target) && e.target !== modelSel) { pop.remove(); document.removeEventListener("click", close, true); } };
      setTimeout(() => document.addEventListener("click", close, true), 0);
    };
    const aggState = { value: "off" }; // 默认值随所选策略初始化，用户仍可在允许范围内按次调整
    const isAuto = () => pickState.kind !== "model";
    const pickedPolicy = () => pickState.kind === "policy" ? pickState.value : null;
    const pickedMode = () => pickState.kind === "multi" ? "multi" : (pickState.kind === "model" ? "manual" : "auto");

    const input = el("input", { type: "text", placeholder: "输入消息…", "aria-label": "输入消息", autocomplete: "off" });
    const sendBtn = el("button", { class: "tc-send", title: "发送", "aria-label": "发送" });
    function renderSendBtn() {
      sendBtn.innerHTML = "";
      sendBtn.classList.toggle("stop", busy);
      sendBtn.title = busy ? "中断" : "发送";
      sendBtn.appendChild(busy ? el("span", { style: "width:11px;height:11px;background:#fff;border-radius:2px;display:block" }) : UI.icon("send", 16));
    }
    renderSendBtn();

    // 页面模式的两级选择：左 tab 选策略（右侧显示自动路由）或「固定模型」（右侧出模型下拉）
    const modeBar = el("div", { class: "tc-modebar" });
    function drawModeBar() {
      if (!opts.mountEl || !opts.keepReasoning) return; // 智能交互测试不暴露模型路由选择
      modeBar.innerHTML = "";
      const policies2 = (pickGroups.find(g => g.label === "调度策略") || { items: [] }).items;
      if (!policies2.length) return;
      if (pickState.kind !== "policy" || !policies2.find(it => it.value === pickState.value)) {
        const f = policies2[0]; setPick("policy", f.value, f.label);
      }
      const syncAggregation = (policy) => {
        aggState.value = policy && policy.allow_aggregation ? policy.default_aggregation : "off";
        routeUiState.costAlpha = policy ? policy.alpha : 0.5;
        const allowed = policy && policy.model_whitelist && policy.model_whitelist.length ? policy.model_whitelist : routeUiState.models.map(m => m.model_id);
        const usable = routeUiState.models.filter(m => allowed.includes(m.model_id));
        if (!usable.some(m => m.model_id === routeUiState.answer1)) routeUiState.answer1 = usable[0]?.model_id || null;
        if (!usable.some(m => m.model_id === routeUiState.answer2) || routeUiState.answer2 === routeUiState.answer1) routeUiState.answer2 = usable.find(m => m.model_id !== routeUiState.answer1)?.model_id || null;
        if (!usable.some(m => m.model_id === routeUiState.aggregator)) routeUiState.aggregator = usable[0]?.model_id || null;
      };
      const routeApis=[...new Map(policies2.map(it=>[it.route_api_id,{id:it.route_api_id,name:it.route_api_name}])).values()];
      if(!routeUiState.apiId||!routeApis.some(api=>api.id===routeUiState.apiId))routeUiState.apiId=routeApis[0].id;
      let strategies=policies2.filter(it=>it.route_api_id===routeUiState.apiId);
      if(!strategies.some(it=>it.value===pickState.value)){const first=strategies[0];setPick("policy",first.value,first.label);syncAggregation(first);}
      const control=(label,node,cls="")=>el("label",{class:`tc-route-control ${cls}`},[el("span",{class:"tc-route-label"},[label]),node]);
      modeBar.appendChild(control("路由 API",UI.fancySelect({value:routeUiState.apiId,width:"185px",options:routeApis.map(api=>[api.id,api.name]),onChange:v=>{routeUiState.apiId=v;const first=policies2.find(it=>it.route_api_id===v);if(first){setPick("policy",first.value,first.label);syncAggregation(first);}drawModeBar();}})));
      modeBar.appendChild(control("路由策略",UI.fancySelect({ value: pickState.value, width: "180px",
        options: strategies.map(it => [it.value, it.label]),
        onChange: (v) => {
          const hit = strategies.find(x => x.value === v);
          setPick("policy", v, hit ? hit.label : v);
          syncAggregation(hit);
          drawModeBar();
        } })));
      const activePolicy = policies2.find(it => it.value === pickState.value);
      if (activePolicy && !activePolicy.allow_aggregation) aggState.value = "off";
      const levels=[0,0.2,0.5,0.8,1],idx=Math.max(0,levels.indexOf(routeUiState.costAlpha));
      const costValue=el("span",{class:"tc-cost-value num"},[String(levels[idx])]);
      const costRange=el("input",{type:"range",min:"0",max:"4",step:"1",value:String(idx),disabled:activePolicy&&!activePolicy.allow_cost_preference,title:activePolicy&&!activePolicy.allow_cost_preference?"该策略使用固定成本—效果权重":"拖动设置本次请求的成本—效果偏好"});
      costRange.oninput=()=>{routeUiState.costAlpha=levels[Number(costRange.value)];costValue.textContent=String(routeUiState.costAlpha);};
      if(activePolicy?.allow_cost_preference)modeBar.appendChild(control("成本—效果偏好",el("div",{class:"tc-cost-axis"},[el("span",{class:"muted"},["省钱"]),costRange,el("span",{class:"muted"},["质量"]),costValue])));
      if(activePolicy?.allow_aggregation&&activePolicy?.allow_agg_override)modeBar.appendChild(control("聚合参数",UI.fancySelect({ value: aggState.value, width: "130px",
        options: [["on", "打开聚合"], ["off", "关闭聚合"]],onChange: (v) => { aggState.value = v; drawModeBar(); } })));
      if(activePolicy?.route_type === "manual") {
        const allowedIds = activePolicy.model_whitelist?.length ? activePolicy.model_whitelist : routeUiState.models.map(m => m.model_id);
        const usable = routeUiState.models.filter(m => allowedIds.includes(m.model_id));
        if (!usable.some(m => m.model_id === routeUiState.answer1)) routeUiState.answer1 = usable[0]?.model_id || null;
        const useAggregation = aggState.value === "on" && activePolicy.allow_aggregation;
        if (useAggregation) {
          if (!usable.some(m => m.model_id === routeUiState.answer2) || routeUiState.answer2 === routeUiState.answer1) routeUiState.answer2 = usable.find(m => m.model_id !== routeUiState.answer1)?.model_id || null;
          if (!usable.some(m => m.model_id === routeUiState.aggregator)) routeUiState.aggregator = usable[0]?.model_id || null;
        }
        const nameOf = id => (usable.find(m => m.model_id === id) || {}).display_name || id || "请选择";
        const summary = useAggregation ? `${nameOf(routeUiState.answer1)}、${nameOf(routeUiState.answer2)} → ${nameOf(routeUiState.aggregator)}` : nameOf(routeUiState.answer1);
        const lab = el("span", {class:"fsel-label"}, [summary]);
        const picker = el("button", {class:"fsel tc-role-picker",type:"button"}, [lab,el("span",{class:"fsel-caret"},[UI.icon("chevron",13)])]);
        picker.onclick = () => {
          document.querySelectorAll(".menu-pop").forEach(n => n.remove());
          const pop = el("div", {class:`menu-pop tc-role-pop ${useAggregation?"is-aggregate":"is-single"}`});
          const roleColumn = (title, key, excluded = []) => el("div", {class:"tc-role-column"}, [
            el("div", {class:"tc-role-title"}, [title]),
            ...usable.filter(m=>!excluded.includes(m.model_id)).map(m=>el("button",{class:`menu-item ${routeUiState[key]===m.model_id?"on":""}`,type:"button",onclick:e=>{
              e.stopPropagation(); routeUiState[key]=m.model_id;
              if(key==="answer1"&&routeUiState.answer2===m.model_id)routeUiState.answer2=usable.find(x=>x.model_id!==m.model_id)?.model_id||null;
              if(key==="answer2"&&routeUiState.answer1===m.model_id)routeUiState.answer1=usable.find(x=>x.model_id!==m.model_id)?.model_id||null;
              pop.remove(); drawModeBar(); setTimeout(()=>modeBar.querySelector(".tc-role-picker")?.click(),0);
            }},[m.display_name||m.model_name||m.model_id]))
          ]);
          const answerCard = () => {
            const selected = [routeUiState.answer1, routeUiState.answer2].filter(Boolean);
            return el("div",{class:"tc-role-column tc-answer-multi"},[
              el("div",{class:"tc-role-title"},["回答模型",el("span",{class:"tc-role-count"},[`${selected.length}/2`])]),
              ...usable.map(m=>{const checked=selected.includes(m.model_id);return el("button",{class:`menu-item ${checked?"on":""}`,type:"button",onclick:e=>{
                e.stopPropagation();
                if(checked){UI.toast("聚合必须选择 2 个回答模型",true);return;}
                if(selected.length>=2){routeUiState.answer1=routeUiState.answer2;routeUiState.answer2=m.model_id;}
                else routeUiState.answer2=m.model_id;
                pop.remove();drawModeBar();setTimeout(()=>modeBar.querySelector(".tc-role-picker")?.click(),0);
              }},[el("span",{class:`tc-multi-check ${checked?"on":""}`},[checked?"✓":""]),m.display_name||m.model_name||m.model_id]);})
            ]);
          };
          pop.appendChild(useAggregation
            ? el("div",{class:"tc-role-grid"},[answerCard(),roleColumn("聚合模型","aggregator")])
            : roleColumn("回答模型","answer1"));
          if(useAggregation)pop.appendChild(el("div",{class:"tc-role-tip"},["两个模型分别生成回答，由一个聚合模型融合输出。"]));
          document.body.appendChild(pop);
          const r=picker.getBoundingClientRect(); pop.style.top=(r.top+window.scrollY-pop.offsetHeight-6)+"px"; pop.style.left=Math.max(12,Math.min(r.left+window.scrollX,window.innerWidth-pop.offsetWidth-12))+"px";
          const close=e=>{if(!pop.contains(e.target)&&e.target!==picker){pop.remove();document.removeEventListener("click",close,true);}};
          setTimeout(()=>document.addEventListener("click",close,true),0);
        };
        modeBar.appendChild(control("指定模型",picker,"tc-model-assignment"));
      }
    }
    const composer = el("div", { class: "tc-composer" }, [opts.mountEl ? null : modelSel, input, sendBtn]);
    // 两种宿主：默认右侧抽屉；opts.mountEl 提供容器则渲染为页面内对话区（独立测试页用）
    let mask = null, bodyBox;
    if (opts.mountEl) {
      const host = typeof opts.mountEl === "string" ? document.querySelector(opts.mountEl) : opts.mountEl;
      bodyBox = el("div", { class: "tc-pagebody" }, [msgs]);
      host.innerHTML = "";
      host.appendChild(el("div", { class: "tc-page" }, [bodyBox, el("div", { class: "tc-pagefoot" }, [modeBar, composer])]));
    } else {
      mask = UI.drawer(opts.title || "测试", msgs, composer);
      mask.querySelector(".drawer").style.width = "540px";
      const closeBtn = mask.querySelector(".close-btn");
      if (closeBtn) { closeBtn.textContent = "结束测试"; closeBtn.className = "btn small"; }
      bodyBox = mask.querySelector(".drawer-body");
    }
    const scrollBottom = () => { bodyBox.scrollTop = bodyBox.scrollHeight; };
    setTimeout(() => input.focus(), 150);
    if (opts.prefill) input.value = opts.prefill;
    if (opts.prefill && opts.autosend) setTimeout(() => { const t = input.value.trim(); if (t) { input.value = ""; send(t); } }, 600);

    // 事件上报（与线上同一 Schema；channel=test → 不进回显 / 看板 / 标签）
    function sendEvent(eventType, envelope, payload, extras = {}) {
      const ctx = envelope._ctx || {};
      UI.api("/v1/events", { method: "POST", body: { events: [{
        schema_version: "1.0.0", event_id: crypto.randomUUID(),
        trace_id: ctx.traceId || "unknown", tenant_id: TENANT, session_id: SESSION,
        turn_id: ctx.turnId || "unknown", user_id: USER, ts: new Date().toISOString(),
        event_type: eventType, channel: "test",
        card: { card_id: envelope.card_ref?.card_id || null, card_version: envelope.card_ref?.version || null,
          component_type: envelope.component_type, semantic_category: envelope.semantic_category,
          trigger_source: envelope.trigger_source },
        route_context: ctx.routeContext || {}, payload: { render_id: envelope.render_id, ...(payload || {}) },
        group: null, label_hint: extras.label_hint || null,
      }] } }).catch(() => {});
    }

    function userMsg(text) {
      hint.remove();
      msgs.appendChild(el("div", { class: "tc-u" }, [el("span", {}, [text])]));
      scrollBottom();
    }
    function botBubble() {
      hint.remove();
      const bubble = el("div", { class: "bubble" });
      msgs.appendChild(el("div", { class: "tc-b" }, [el("span", { class: "avatar" }, [UI.icon("bot", 14)]), bubble]));
      return bubble;
    }

    async function send(text, cardContext, o = {}) {
      if (busy || !text) return;
      const currentPolicy = (pickGroups.find(g => g.items?.some(it => it.value === pickState.value))?.items || []).find(it => it.value === pickState.value);
      if (currentPolicy?.route_type === "manual" && aggState.value === "on") {
        const answers = [routeUiState.answer1, routeUiState.answer2].filter(Boolean);
        if (new Set(answers).size !== 2) { UI.toast("请先指定 2 个不同的回答模型", true); return; }
        if (!routeUiState.aggregator) { UI.toast("请先指定聚合模型", true); return; }
      }
      busy = true; renderSendBtn(); modelSel.disabled = true;
      const isReal = !cardContext && !o.silent;
      if (isReal) { userMsg(text); lastQuestion = text; }
      const originText = isReal ? text : lastQuestion;

      const bubble = botBubble();
      // 智能交互测试：路由过程属于模型路由平台，不展示步骤，只给轻量思考指示
      const reason = el("div", { class: "model-answering" }, [el("span", { class: "answering-spinner" }),el("span", { class: "muted" }, ["模型回答中..."])]);
      bubble.appendChild(reason);
      scrollBottom();
      const addStep = (t, evt2) => {
        if (!opts.keepReasoning) return;
        // 回答模型和聚合模型会在最终决策行中明确展示，避免在过程里重复一遍。
        if (["fastlane", "switch", "manual_select"].includes(evt2?.step)) return;
        const node = el("div", { class: "reason-step", style:"display:none" }, [el("span", { class: "dot" }, ["·"]), el("span", {}, [t])]);
        reason.appendChild(node);
        // 粗排打分：展示各候选模型的历史命中率（论文 Step 2 的过程数据）
        if (opts.keepReasoning && evt2 && evt2.scores) {
          const ranked = Object.entries(evt2.scores).sort((x, y) => y[1] - x[1]).slice(0, 5);
          const maxV = ranked.length ? ranked[0][1] || 1 : 1;
          reason.appendChild(el("div", { class: "rs-bars", style:"display:none" }, ranked.map(([mid, v]) =>
            el("div", { class: "rs-row" }, [
              el("span", { class: "rs-m num" }, [mid]),
              el("div", { class: "rs-track" }, [el("div", { class: "rs-fill" + ((evt2.candidates || []).includes(mid) ? " on" : ""), style: `width:${Math.round(v / maxV * 100)}%` })]),
              el("span", { class: "rs-v num" }, [Number(v).toFixed(2)]),
            ]))));
        }
        scrollBottom();
      };

      ctrl = new AbortController();
      try {
        const res = await fetch("/v1/route", {
          method: "POST", headers: { "Content-Type": "application/json" }, signal: ctrl.signal,
          body: JSON.stringify({ tenant_id: TENANT, session_id: SESSION, user_id: USER, text,
            card_context: cardContext, skip_card_match: !!o.skipCardMatch,
            mode: pickedMode(), manual_model: pickState.kind === "model" ? pickState.value : null,
            aggregate: opts.keepReasoning ? aggState.value : undefined,
            cost_effect_alpha: opts.keepReasoning ? routeUiState.costAlpha : undefined,
            policy_id: pickedPolicy(),
            answer_models: pickState.kind === "policy" ? [routeUiState.answer1, routeUiState.answer2].filter(Boolean) : undefined,
            aggregator_model: pickState.kind === "policy" ? routeUiState.aggregator : undefined }),
        });
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let idx;
          while ((idx = buf.indexOf("\n\n")) >= 0) {
            const chunk = buf.slice(0, idx).trim();
            buf = buf.slice(idx + 2);
            if (!chunk.startsWith("data:")) continue;
            const evt = JSON.parse(chunk.slice(5));
            if (evt.step === "final") renderFinal(bubble, reason, evt, originText);
            else if (evt.text) addStep(evt.text, evt);
          }
        }
      } catch (err) {
        if (err.name === "AbortError") {
          reason.remove();
          bubble.appendChild(el("div", { class: "secondary" }, ["已中断"]));
        } else {
          reason.remove();
          bubble.appendChild(el("div", { class: "field-error" }, ["请求失败：" + err.message]));
          bubble.appendChild(el("div", { style: "margin-top:6px" }, [
            el("button", { class: "btn small", onclick: (e2) => { e2.target.closest(".tc-b")?.remove(); send(text, cardContext, o); } }, ["重试"]),
          ]));
        }
      }
      ctrl = null; busy = false; renderSendBtn(); modelSel.disabled = false;
      if (isReal) input.focus();
    }

    function renderFinal(bubble, reason, evt, originText) {
      const steps = reason.querySelectorAll(".reason-step").length;
      const processNodes = [...reason.childNodes].filter(n => n.classList &&
        (n.classList.contains("reason-step") || n.classList.contains("rs-bars")));
      const ctx = {
        traceId: evt.trace_id, turnId: evt.turn_id, sessionId: SESSION, userId: USER,
        routeContext: evt.route_context || {},
        titleInBubble: true,
        sendEvent: (type, envelope, payload, extras) => { envelope._ctx = ctx; sendEvent(type, envelope, payload, extras); },
        onCollectSubmit: (payload, envelope, extras = {}) => {
          envelope._ctx = ctx;
          sendEvent("card_submitted", envelope, payload, {});
          const summary = extras.summaryOverride ||
            (payload.form_values ? Object.entries(payload.form_values).map(([k, v]) => `${k}=${v}`).join("，")
              : `选择了「${payload.user_selection}」`);
          send("请基于我的提交继续", { summary, card_id: envelope.card_ref?.card_id || null,
            selection: Array.isArray(payload.user_selection) ? payload.user_selection[0] : payload.user_selection });
        },
        onControl: (action, envelope) => {
          envelope._ctx = ctx;
          sendEvent("control_invoked", envelope, { action });
          if (envelope.component_type === "control.confirm" && action === "confirm")
            send("继续执行刚才的操作", { summary: "用户已确认执行该高风险操作" });
        },
      };
      // 回答优先；路由决策过程作为回答后的按需展开信息。
      let ansTag = null, candDetails = null, decisionToggle = null, routeCard = null;
      if (evt.decision_summary && opts.keepReasoning) {
        const d = evt.decision_summary;
        const pol = d.policy || {};
        const modelName = (id) => {
          const hit = (pickGroups.find(g => g.label === "指定模型") || { items: [] }).items.find(x => x.value === id);
          return hit ? hit.label : (id || "-");
        };
        const finalName = d.final_model || "-";
        const answerModels = d.candidates && d.candidates.length ? d.candidates : [finalName];
        const calls = d.model_calls || [];
        const agg = d.aggregation_decision || {};
        const f3 = value => Number.isFinite(Number(value)) ? Number(value).toFixed(3) : "-";
        const stepTexts = [...reason.querySelectorAll(".reason-step")].map(n => n.textContent.replace(/^·/, "").trim());
        const kv = (k, v) => el("div", { class: "rd-kv" }, [el("span", {}, [k]), el("strong", {}, [String(v ?? "-")])]);
        const recognition=stepTexts.find(t=>t.includes("识别任务画像"))||stepTexts[0]||"本次未进行任务画像识别";
        const sections = [el("section", { class: "rd-section" }, [el("h4", {}, ["1. 任务画像识别"]),el("div", { class: "rd-step" }, [el("span", { class: "rd-no" }, ["1"]),el("span", {}, [recognition])])])];
        if (d.score_details && Object.keys(d.score_details).length) {
          const rows = Object.entries(d.score_details).sort((a,b)=>b[1].combined_score-a[1].combined_score);
          sections.push(el("section", { class: "rd-section" }, [
            el("h4", {}, ["2. 候选模型评分"]),
            el("div", { class: "rd-formula num" }, [`质量分权重 ${f3(d.effective_alpha ?? pol.alpha)}、便宜分权重 ${f3(1-(d.effective_alpha ?? pol.alpha))}；综合分 = ${f3(d.effective_alpha ?? pol.alpha)} × 质量分 + ${f3(1-(d.effective_alpha ?? pol.alpha))} × 便宜分`]),
            el("div", { class: "rd-table-wrap" }, [el("table", { class: "rd-table" }, [
              el("thead", {}, [el("tr", {}, ["排名", "模型", "质量分", "便宜分", "综合分"].map(x=>el("th",{},[x])))]),
              el("tbody", {}, rows.map(([id,s],i)=>el("tr",{},[i+1,modelName(id),f3(s.quality_score),f3(s.cheap_score),f3(s.combined_score)].map((x,j)=>el("td",{class:j!==1?"num":""},[String(x)])))))
            ])]),el("div", { class:"rd-selected-list" }, (d.switch_result==="aggregated"?answerModels.slice(0,2):answerModels.slice(0,1)).map((id,i)=>{const call=calls.find(c=>c.role==="answer"&&c.model_id===id)||calls.find(c=>c.model_id===id)||{};return el("div", { class:"rd-selected" }, [`回答模型 ${i+1}：`,el("strong",{},[modelName(id)]),el("span",{class:"num"},[` · ${(call.tokens_in||0)+(call.tokens_out||0)+(call.tokens_thinking||0)} Token · ${UI.fmtMs(call.latency_ms||0)}`])]);}))
          ]));
        }
        const aggRows=Object.entries(agg.score_details||{}).sort((a,b)=>b[1].score-a[1].score);
        const aggregatorCall=calls.find(c=>c.role==="aggregator")||calls.find(c=>c.model_id===d.aggregator)||{};
        sections.push(el("section", { class: "rd-section" }, [
          el("h4", {}, [d.score_details ? "3. 聚合模型选择" : "2. 聚合模型选择"]),
          agg.used||d.switch_result==="aggregated"
            ? el("div", {}, [
                el("div", { class: "rd-formula" }, [`聚合模型得分 = ${f3(agg.weights?.task??.6)} × 本任务质量 + ${f3(agg.weights?.knowledge??.2)} × 知识问答 + ${f3(agg.weights?.judgment??.2)} × 学术写作`]),
                el("div", { class:"rd-table-wrap", style:"margin-top:8px" }, [el("table", { class:"rd-table" }, [el("thead",{},[el("tr",{},["排名","模型","本任务质量","知识问答","学术写作","聚合得分"].map(x=>el("th",{},[x])))]),el("tbody",{},aggRows.map(([id,s],i)=>el("tr",{},[i+1,modelName(id),f3(s.task),f3(s.knowledge),f3(s.judgment),f3(s.score)].map((x,j)=>el("td",{class:j!==1?"num":""},[String(x)])))))])]),
                el("div", { class:"rd-selected" }, ["聚合模型：",el("strong",{},[modelName(d.aggregator)]),el("span",{class:"num"},[` · ${(aggregatorCall.tokens_in||0)+(aggregatorCall.tokens_out||0)+(aggregatorCall.tokens_thinking||0)} Token · ${UI.fmtMs(aggregatorCall.latency_ms||0)}`])])
              ])
            : el("div", { class: "muted" }, ["本次未开启聚合，不执行聚合模型选择。"]),
        ]));
        routeCard = el("div", { class: "route-decision-card", hidden: "" }, [el("div", { class: "rd-head" }, [el("strong", {}, ["路由决策过程"])]),...sections]);
        decisionToggle = el("button", { class: "decision-toggle", type: "button" }, ["展开路由决策过程"]);
        decisionToggle.onclick = () => { const opening = routeCard.hidden; routeCard.hidden = !opening; decisionToggle.textContent = opening ? "收起路由决策过程" : "展开路由决策过程"; };
        // 底部标签：同首页卡片式（蓝 chip + 小字）
        const tagText = {
          explore: `随机探索 · ${modelName(finalName)}`,
          aggregated: `聚合定稿 · 由 ${modelName(d.aggregator || finalName)} 融合重写`,
          fastlane: `回答模型 · ${modelName(finalName)}`,
          routed: `单模型路由 · ${modelName(finalName)}`,
          fallback: `兜底直连 · ${modelName(finalName)}`,
          manual: `手动指定 · ${modelName(finalName)}`,
          degraded: "已降级处理",
        }[d.switch_result] || d.switch_result;
        ansTag = el("div", { class: "ans-tags" }, [
          el("span", { class: "chip ai" }, [tagText]),
          decisionToggle,
          el("span", { class: "muted", style: "font-size:var(--font-caption)" },
            [`${calls.reduce((s,c)=>s+(c.tokens_in||0)+(c.tokens_out||0)+(c.tokens_thinking||0),0)} Token · ${UI.fmtMs(d.total_latency_ms)}`]),
        ]);
        if (d.switch_result === "aggregated") {
          const pref = (evt.components || []).find(c2 => c2.component_type === "feedback.preference");
          const cands = pref?.params?.candidates || [];
          if (cands.length) candDetails = el("details", { style: "margin-top:4px" }, [
            el("summary", { class: "muted", style: "cursor:pointer;font-size:var(--font-small)" }, [`查看 ${cands.length} 份候选回答`]),
            ...cands.map(c2 => el("div", { class: "agg-cand" }, [
              el("div", { class: "muted num" }, [c2.model_id || c2.alias]),
              el("div", {}, [c2.content]),
            ])),
          ]);
        }
      }
      if (!routeCard) {
        if (!steps) reason.remove();
        else {
          const summary = el("details", {}, [el("summary", { class: "muted", style: "cursor:pointer" },
            [`思考过程（${steps} 步）`]), ...processNodes]);
          reason.replaceWith(el("div", { class: "reason-panel" }, [summary]));
        }
      } else reason.remove();
      if (evt.content) bubble.appendChild(el("div", { class: "answer-content" }, [evt.content]));
      if (ansTag) bubble.appendChild(ansTag);
      if (routeCard) bubble.appendChild(routeCard);
      if (candDetails) bubble.appendChild(candDetails);
      if (evt.ask_card) {
        const env = evt.ask_card;
        env._ctx = ctx;
        if (env.params?.prompt && env.params.reply_text) bubble.appendChild(el("div", { class: "bubble-prompt" }, [env.params.prompt]));
        bubble.appendChild(Components.render(env, ctx));
        bubble.appendChild(el("div", { style: "margin-top:6px;display:flex;gap:8px;align-items:center" }, [
          el("button", { class: "btn small", style: "border:none;color:var(--text-muted)", onclick: (e) => {
            if (env._submitted || env._skipped) return;
            env._skipped = true; e.target.disabled = true;
            send(originText, null, { silent: true, skipCardMatch: true });
          } }, ["跳过，直接回答"]),
          opts.editableCards && env.card_ref?.card_id
            ? el("a", { class: "btn small ghost", href: "./cards.html?edit=" + env.card_ref.card_id,
                title: "对触发效果或组件内容不满意？直接改这条配置",
                onclick: (e) => {
                  // 离开会丢当前测试对话，轻确认
                  if (!confirm("去编辑这条配置？当前测试对话不会保留。")) e.preventDefault();
                } }, [UI.icon("edit", 13), "编辑这条配置"])
            : null,
        ]));
      }
      // 呈现型组件照常渲染（评价型在测试抽屉里省略）
      (evt.components || []).filter(c => c.semantic_category === "present").forEach(c => { c._ctx = ctx; bubble.appendChild(Components.render(c, ctx)); });
      scrollBottom();
    }

    sendBtn.onclick = () => {
      if (busy) { if (ctrl) ctrl.abort(); return; }
      const t = input.value.trim();
      if (t) { input.value = ""; send(t); }
    };
    input.addEventListener("keydown", e => { if (e.key === "Enter" && !busy) sendBtn.onclick(); });
    return mask;
  }

  return { open };
})();
