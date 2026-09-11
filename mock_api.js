// GitHub Pages 静态演示：拦截 API 请求，用预置数据模拟服务端。完整能力请本地运行仓库。
(function () {
  const D = window.MOCK_DATA || {};
  const realFetch = window.fetch.bind(window);
  const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });

  // v7 会话状态机：配置智能路由模型 → benchmark 得分表（点格修正）→ 判维路由（静态站可走完整动线）
  const v7 = { router: null, overrides: {}, asof: null };
  const policyLocal = { policies: null };
  const SMART_AGGREGATION_WEIGHTS = { task: 0.6, reasoning: 0.2, judgment: 0.2 };
  function defaultPolicyParams(overrides) {
    const params={ K: 3, N_base: 50, beta: 0.5, professional_domain_weight: 0.5,
      gamma: 0.95, eps: 0.5, sigma: 0.3, delta: 0.2, t: 0.8, max_agg_tokens: 13000,
      fallback_model: "atlas-72b", default_aggregation: "off", ...overrides };
    if(params.route_type==="manual")delete params.fallback_model;
    return params;
  }
  function defaultPolicies() {
    return [
      { policy_id: "policy-manual", name: "手动路由", route_type: "manual", scope: "custom",
        tenant_id: "tenant-demo", scene: null,
        params: defaultPolicyParams({ route_type: "manual", alpha: 0.5, allow_cost_effect_preference: false,
          allow_agg_override: 1, default_aggregation: "off" }),
        latency_tier: "balanced", allow_aggregation: 1, explore_ratio: 0, model_whitelist: [],
        budget_cap: {}, enabled: 1, ab_group: null, ab_split: 50, version: 1,
        api_key: "sk-route-manual000000", system_preset: 1 },
      { policy_id: "policy-global-balanced", name: "全局均衡", route_type: "smart", scope: "global",
        tenant_id: null, scene: null,
        params: defaultPolicyParams({ route_type: "smart", router_model: "swift-4b", alpha: 0.5, beta: 0.5,
          professional_domain_weight: 0.5, aggregation_weights: { ...SMART_AGGREGATION_WEIGHTS },
          allow_cost_effect_preference: true, allow_agg_override: 1, default_aggregation: "off" }),
        latency_tier: "balanced", allow_aggregation: 1, explore_ratio: 0.05, model_whitelist: [],
        budget_cap: {}, enabled: 1, ab_group: null, ab_split: 50, version: 1,
        api_key: "sk-route-8e82edc914e7cbd5", system_preset: 1 },
      { policy_id: "policy-scene-fast", name: "省钱优先", route_type: "smart", scope: "custom",
        tenant_id: "tenant-demo", scene: null,
        params: defaultPolicyParams({ route_type: "smart", router_model: "swift-4b", K: 1, alpha: 0.2, beta: 0.5,
          professional_domain_weight: 0.5, aggregation_weights: { ...SMART_AGGREGATION_WEIGHTS },
          allow_cost_effect_preference: false, allow_agg_override: 0, default_aggregation: "off" }),
        latency_tier: "fast", allow_aggregation: 0, explore_ratio: 0.02, model_whitelist: [],
        budget_cap: {}, enabled: 1, ab_group: null, ab_split: 50, version: 1,
        api_key: "sk-route-a996df0be0058eef", system_preset: 1 },
      { policy_id: "policy-scene-quality", name: "专家模式", route_type: "smart", scope: "custom",
        tenant_id: "tenant-demo", scene: null,
        params: defaultPolicyParams({ route_type: "smart", router_model: "swift-4b", alpha: 0.8, beta: 0.5,
          professional_domain_weight: 0.5, aggregation_weights: { ...SMART_AGGREGATION_WEIGHTS },
          allow_cost_effect_preference: false, allow_agg_override: 1, default_aggregation: "on" }),
        latency_tier: "quality", allow_aggregation: 1, explore_ratio: 0.08, model_whitelist: [],
        budget_cap: {}, enabled: 1, ab_group: null, ab_split: 50, version: 1,
        api_key: "sk-route-8fe4fcb5c12ca9ae", system_preset: 1 },
    ];
  }
  function policyState() {
    if (!policyLocal.policies) policyLocal.policies = defaultPolicies();
    return policyLocal.policies;
  }
  function mergePolicy(existing, body) {
    body = body || {};
    const top = { ...existing, ...body };
    const incomingParams = { ...(body.params || {}) };
    ["alpha", "beta", "professional_domain_weight", "aggregation_weights", "router_model",
      "allow_cost_effect_preference", "allow_agg_override", "fallback_model", "default_aggregation"].forEach(k => {
      if (body[k] !== undefined) incomingParams[k] = body[k];
    });
    top.params = { ...(existing.params || {}), ...incomingParams };
    const routeType = body.route_type || incomingParams.route_type || existing.route_type ||
      (existing.params || {}).route_type || "smart";
    top.route_type = routeType;
    top.params.route_type = routeType;
    if (incomingParams.beta !== undefined && incomingParams.professional_domain_weight === undefined)
      top.params.professional_domain_weight = incomingParams.beta;
    else if (incomingParams.professional_domain_weight !== undefined && incomingParams.beta === undefined)
      top.params.beta = incomingParams.professional_domain_weight;
    else if (top.params.beta == null && top.params.professional_domain_weight != null)
      top.params.beta = top.params.professional_domain_weight;
    else if (top.params.professional_domain_weight == null && top.params.beta != null)
      top.params.professional_domain_weight = top.params.beta;
    if (routeType === "smart") {
      top.params.aggregation_weights = { ...SMART_AGGREGATION_WEIGHTS,
        ...((existing.params || {}).aggregation_weights || {}), ...(top.params.aggregation_weights || {}) };
    }
    if (!top.allow_aggregation) top.params.default_aggregation = "off";
    else if (!["on", "off"].includes(top.params.default_aggregation)) top.params.default_aggregation = "off";
    if (!Array.isArray(top.model_whitelist)) top.model_whitelist = [];
    if (routeType === "smart" && !top.params.fallback_model) top.params.fallback_model = "atlas-72b";
    if (routeType === "manual") delete top.params.fallback_model;
    return top;
  }
  const deadCards = new Set(); // 静态站会话内删除的配置
  const cardStatus = {}; // 会话内上下线状态（否则点「下线」快照回读=界面无反应且无法编辑）
  const prodLocal = { created: [], updated: {}, deleted: new Set() }; // 会话内产品操作
  // 模型操作会话内状态：设默认兜底 / 启停 / 思考开关 / 编辑 / 删除（否则快照回读=界面无反应）
  const modelLocal = { defaultId: null, status: {}, thinking: {}, updated: {}, deleted: new Set(), created: [] };
  // 当前版任务画像：代码、复杂推理、创意写作、研判写作、数据分析、多步规划/工具调用。
  const DIM_KEYWORDS = {
    coding: ["SQL", "sql", "代码", "脚本", "接口", "报错", "正则", "函数", "调试", "同步失败"],
    reasoning: ["计算", "求解", "推理", "证明", "为什么", "因果", "利息", "折算"],
    creative: ["创意", "文案", "故事", "广告", "标题", "命名", "改写", "润色"],
    judgment: ["分析", "研判", "比较", "评估", "风险", "建议", "起草", "通知", "邮件", "汇报"],
    data: ["数据", "趋势", "毛利", "百分", "利率", "环比", "同比", "报表", "统计", "结构"],
    planning: ["计划", "规划", "步骤", "流程", "工具", "执行", "JSON", "表格输出", "按格式", "逐条"],
  };
  const MULTIMODAL_KEYWORDS = ["图片", "图像", "截图", "照片", "识别图", "看图", "音频", "语音", "视频", "扫描件"];
  const QUALITY_TO_BENCH = { coding: "coding", reasoning: "math", creative: "writing", judgment: "writing", data: "math", planning: "instruct" };
  const CHAT_WORDS = ["你好", "谢谢", "在吗", "你是谁", "早上好"];
  function classifyDims(text) {
    const hits = [];
    Object.keys(DIM_KEYWORDS).forEach(d => {
      const s = DIM_KEYWORDS[d].reduce((n, w) => n + (text.includes(w) ? 1 : 0), 0);
      if (s) hits.push([s, d]);
    });
    hits.sort((a, b) => b[0] - a[0]);
    let dims = hits.slice(0, 2).map(h => h[1]);
    return dims.length ? dims : ["reasoning"];
  }
  const DIM_CN = { coding: "代码能力", reasoning: "复杂推理", creative: "创意写作", judgment: "研判写作",
    data: "数据分析", planning: "多步规划/工具调用" };
  function benchState() {
    const base = JSON.parse(JSON.stringify(D["/api/benchmark"] || { dims: [], scores: {}, models: [], overrides: {},
      asof: "2026-08", source: "公开榜单汇总" }));
    Object.keys(v7.overrides).forEach(mid => {
      base.scores[mid] = { ...(base.scores[mid] || {}) };
      base.overrides[mid] = { ...(base.overrides[mid] || {}) };
      Object.keys(v7.overrides[mid]).forEach(d => {
        if (v7.overrides[mid][d] === "__reset__") { delete base.overrides[mid][d]; return; }
        base.scores[mid][d] = v7.overrides[mid][d];
        base.overrides[mid][d] = v7.overrides[mid][d];
      });
    });
    base.models = (base.models || []).filter(m => !modelLocal.deleted.has(m.model_id))
      .map(m => ({ ...m, ...(modelLocal.updated[m.model_id] || {}) }));
    if (v7.asof) base.asof = v7.asof;
    base.router = v7.router;
    return base;
  }
  function getMock(pn, full) {
    if (pn === "/api/products") {
      const base = JSON.parse(JSON.stringify(D[pn] || { products: [] }));
      base.products = (base.products || []).filter(p => !prodLocal.deleted.has(p.product_id))
        .map(p => ({ ...p, ...(prodLocal.updated[p.product_id] || {}) }))
        .concat(prodLocal.created);
      return base;
    }
    if (pn === "/api/cards") {
      const base = JSON.parse(JSON.stringify(D[pn] || { cards: [] }));
      base.cards = (base.cards || []).filter(c => !deadCards.has(c.card_id))
        .map(c => cardStatus[c.card_id] ? { ...c, status: cardStatus[c.card_id] } : c);
      return base;
    }
    if (pn === "/api/benchmark") {
      return benchState();
    }
    if (pn === "/api/settings/router-model") {
      return { router: v7.router };
    }
    if (pn === "/api/profile") {
      const bm = benchState();
      const models = bm.models.filter(m => modelLocal.status[m.model_id] !== "disabled");
      const names = {};
      models.forEach(m => { names[m.model_id] = m.display_name; });
      const q2 = new URLSearchParams((full || "").split("?")[1] || "");
      const pid = q2.get("policy_id");
      const pol = policyState().find(p => p.policy_id === pid);
      const alpha = pol ? ((pol.params || {}).alpha ?? 0.5) : 0.5;
      const inv = {}; let lo = Infinity, hi = -Infinity;
      models.forEach(m => { const v = 1 / Math.max(0.01, (m.price_input || 0) + (m.price_output || 0));
        inv[m.model_id] = v; lo = Math.min(lo, v); hi = Math.max(hi, v); });
      const eff = {}; Object.keys(inv).forEach(mid => { eff[mid] = hi > lo ? Math.round((inv[mid] - lo) / (hi - lo) * 1000) / 1000 : 0.5; });
      const clusters = (bm.dims || []).map(d => {
        const scores = {};
        models.forEach(m => {
          const raw = (bm.scores[m.model_id] || {})[d.key];
          const perf = raw == null ? null : Math.round(raw / 100 * 1000) / 1000;
          const combined = perf == null ? null : Math.round((alpha * perf + (1 - alpha) * eff[m.model_id]) * 1000) / 1000;
          scores[m.model_id] = { perf, eff: eff[m.model_id], combined, raw,
            override: d.key in ((bm.overrides || {})[m.model_id] || {}) };
        });
        const valid = Object.entries(scores).filter(([, s]) => s.combined != null);
        valid.sort((a, b) => b[1].combined - a[1].combined);
        const best = valid.length ? valid[0][0] : null;
        const t = pol ? ((pol.params || {}).t ?? 0.8) : 0.8;
        const aggWith = (pol ? pol.allow_aggregation : 1) && valid.length >= 2 &&
          valid[0][1].combined - valid[1][1].combined < Math.max(0.02, (1 - t) * 0.3) ? valid[1][0] : null;
        return { domain: d.key, label: d.label, bench: d.bench, scores, best, agg_with: aggWith };
      });
      return { generated: true, asof: bm.asof, alpha, clusters, models: names, router: v7.router };
    }
    if (pn === "/v1/models") {
      const base = JSON.parse(JSON.stringify(D[pn] || { models: [] }));
      base.models = (base.models || []).concat(modelLocal.created).filter(m => !modelLocal.deleted.has(m.model_id)).map(m => {
        const out = { ...m, ...(modelLocal.updated[m.model_id] || {}) };
        // 为旧快照补齐计费类型示例：Sage 节点演示固定套餐，其余仍按现有部署方式推断。
        // 用户在「模型接入」中保存的 api_type 会覆盖这里的演示默认值。
        if (!((out.capabilities || {}).api_type) && out.model_id === "sage-r1") {
          out.capabilities = { ...(out.capabilities || {}), api_type: "package" };
        }
        if (modelLocal.status[m.model_id]) out.status = modelLocal.status[m.model_id];
        if (modelLocal.defaultId) out.is_default = m.model_id === modelLocal.defaultId ? 1 : 0;
        if (modelLocal.thinking[m.model_id] !== undefined) {
          out.capabilities = { ...(out.capabilities || {}), thinking_enabled: modelLocal.thinking[m.model_id] };
        }
        return out;
      });
      return base;
    }
    if (pn === "/v1/policies") {
      return { policies: JSON.parse(JSON.stringify(policyState())) };
    }
    if (D[pn] !== undefined) return D[pn];
    const m = pn.match(/^\/api\/cards\/([^/]+)$/);
    if (m && D["/api/cards"]) {
      const card = D["/api/cards"].cards.find(c => c.card_id === m[1]);
      if (card) return { card: cardStatus[card.card_id] ? { ...card, status: cardStatus[card.card_id] } : card };
    }
    if (pn.startsWith("/api/dashboard/questions")) return D["/api/dashboard/questions"];
    if (pn.startsWith("/api/dashboard/insights")) return D["/api/dashboard/insights"];
    if (pn.startsWith("/api/dashboard/overview")) return D["/api/dashboard/overview"];
    const em = pn.match(/^\/v1\/embed\/envelope\/([^/]+)$/);
    if (em && D["/api/cards"]) {
      const card = D["/api/cards"].cards.find(c => c.card_id === em[1])
        || D["/api/cards"].cards.find(c => c.status === "published");
      if (card) {
        const cfg = (card.field_bindings || {}).config || {};
        return { envelope: { schema_version: "1.0.0", render_id: "emb-" + Math.random().toString(36).slice(2, 8),
          component_type: card.component_type, semantic_category: "collect", trigger_source: "sdk_embed",
          card_ref: { card_id: card.card_id, version: card.version },
          params: { prompt: (card.text_templates || {}).prompt || card.name,
            reply_text: (card.text_templates || {}).reply || "",
            submit_label: (card.text_templates || {}).submit || "提交",
            options: cfg.options || [], option_meta: cfg.option_meta || {}, option_actions: cfg.option_actions || {},
            display: cfg.display || "", recommended_default: cfg.recommended_default || null,
            fields: cfg.fields || [], likert: cfg.likert || null, slider: cfg.slider || null,
            dimensions: cfg.dimensions || [], values: cfg.values || null, placeholder: cfg.placeholder || "",
            echo_results: false } },
          card: { card_id: card.card_id, name: card.name, version: card.version } };
      }
    }
    return {};
  }

  function postMock(pn, body) {
    if (pn === "/v1/model-nodes") {
      const ids = [];
      (body.model_names || []).forEach((name, i) => {
        const mid = String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 18) + "-" + Math.random().toString(36).slice(2, 6);
        ids.push(mid); modelLocal.created.push({ model_id: mid, model_name: name, display_name: body.node_name,
          provider: body.provider, endpoint: body.endpoint, credential_masked: "sk-****", price_input: 0, price_output: 0,
          capabilities: { node_id: body.node_id, node_name: body.node_name, model_series: body.model_series,
            model_brand: body.model_brand, api_protocol: "OpenAI", api_type: body.api_type }, status: "active",
          bank_coverage: 1, deploy_type: body.api_type === "private" ? "self_hosted" : "api" });
      });
      return { ok: true, node_id: body.node_id, model_ids: ids };
    }
    if (/^\/v1\/model-nodes\/[^/]+$/.test(pn)) {
      const nodeId = decodeURIComponent(pn.split("/")[3]);
      const all = ((D["/v1/models"] || {}).models || []).concat(modelLocal.created);
      const existing = all.filter(m => !modelLocal.deleted.has(m.model_id) && (((m.capabilities || {}).node_id || `legacy-provider-${m.provider || m.model_id}`) === nodeId));
      const wanted = new Set(body.model_names || []);
      existing.forEach(m => { if (!wanted.has(m.model_name)) modelLocal.deleted.add(m.model_id); else modelLocal.updated[m.model_id] = {
        display_name: body.node_name, provider: body.provider, endpoint: body.endpoint, deploy_type: body.api_type === "private" ? "self_hosted" : "api",
        capabilities: { ...(m.capabilities || {}), node_id: nodeId, node_name: body.node_name, model_series: body.model_series,
          model_brand: body.model_brand, api_protocol: "OpenAI", api_type: body.api_type } }; });
      const have = new Set(existing.map(m => m.model_name));
      (body.model_names || []).filter(n => !have.has(n)).forEach(name => {
        const mid = String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0,18)+"-"+Math.random().toString(36).slice(2,6);
        modelLocal.created.push({model_id:mid,model_name:name,display_name:body.node_name,provider:body.provider,endpoint:body.endpoint,credential_masked:"sk-****",price_input:0,price_output:0,capabilities:{node_id:nodeId,node_name:body.node_name,model_series:body.model_series,model_brand:body.model_brand,api_protocol:"OpenAI",api_type:body.api_type},status:"active",bank_coverage:1,deploy_type:body.api_type==="private"?"self_hosted":"api"});
      });
      return { ok: true };
    }
    if (/^\/v1\/model-nodes\/[^/]+\/delete$/.test(pn)) { (body.model_ids || []).forEach(id => modelLocal.deleted.add(id)); return { ok: true }; }
    if (pn === "/api/apikeys") {
      const name = (body && body.name || "").trim();
      if (!name || name.length > 15) return { error: "名称必填，1-15 字" };
      return { key_id: Math.random().toString(36).slice(2, 10), name,
        secret: "sk-live-" + Array.from(crypto.getRandomValues(new Uint8Array(16))).map(b2 => b2.toString(16).padStart(2, "0")).join("") };
    }
    if (/^\/api\/apikeys\/[^/]+\/delete$/.test(pn)) return { ok: true };
    if (pn === "/v1/events") return { accepted: (body && body.events || []).length || 1 };
    if (pn.endsWith("/transition")) {
      const cid = pn.split("/")[3];
      const action = body && body.action;
      if (action === "publish") cardStatus[cid] = "published";
      else if (action === "offline") cardStatus[cid] = "offline";
      const base = ((D["/api/cards"] || {}).cards || []).find(c => c.card_id === cid);
      return { ok: true, card: base ? { ...base, status: cardStatus[cid] || base.status } : null };
    }
    if (pn === "/api/templates/suggest") {
      const t = (D["/api/templates"] || { templates: [] }).templates.slice(0, 3);
      return { suggestions: t.map(x => ({ component_type: x.component_type, name: x.name, reason: "按场景匹配推荐" })) };
    }
    if (pn === "/api/scenarios/rewrite-trigger") {
      // 与服务端 cards.rewrite_trigger 同规则：口语描述 → 规范触发描述 + 3 条示例问法（任意输入都产出完整结构）
      let core = ((body && body.description) || (body && body.text) || "").trim().replace(/[。，,.]+$/, "");
      if (!core) return { trigger_description: "", trigger_examples: [] };
      for (const pre of ["当用户", "用户", "当", "如果", "客户"]) {
        if (core.startsWith(pre)) { core = core.slice(pre.length); break; }
      }
      for (const suf of ["的时候", "的情况下", "时"]) {
        if (core.endsWith(suf)) { core = core.slice(0, -suf.length); break; }
      }
      return {
        trigger_description: `当用户${core}时触发本配置。适用于该场景下的咨询、求助与处理请求；不适用于普通闲聊或与此无关的问题。触发后按本配置的信息与交互组件引导用户。`,
        trigger_examples: [`${core}，怎么处理`, `我遇到了${core}的情况`, `关于${core}想咨询一下`],
      };
    }
    if (pn === "/api/cards") return { card: { card_id: "demo-" + Math.random().toString(36).slice(2, 8), version: 0, status: "draft", ...(body || {}) } };
    if (pn === "/api/settings/router-model") {
      const mid = (body && body.model_id || "").trim();
      if (!mid) { v7.router = null; return { ok: true, router: null }; }
      if (!(body && body.display_name)) return { error: "请填写显示名" };
      if (!/^[a-z0-9][a-z0-9-]{1,23}$/.test(mid)) return { error: "模型 ID 需为 2-24 位小写字母、数字或短横线" };
      v7.router = { model_id: mid, display_name: body.display_name,
        endpoint: (body && body.endpoint) || "", credential_ref: (body && body.credential_ref) || "" };
      return { ok: true, router: v7.router };
    }
    if (pn === "/api/benchmark/score") {
      const mid = (body && body.model_id || "").trim(), dim = (body && body.dim || "").trim();
      const dims = ((D["/api/benchmark"] || {}).dims || []).map(d => d.key);
      if (!dims.includes(dim)) return { error: "未知维度" };
      let score = body ? body.score : undefined;
      if (score !== null) {
        score = Number(score);
        if (!Number.isFinite(score)) return { error: "得分需为 0-100 的数字，或 null 标记缺失" };
        if (score < 0 || score > 100) return { error: "得分需在 0-100 之间" };
      }
      v7.overrides[mid] = { ...(v7.overrides[mid] || {}) };
      v7.overrides[mid][dim] = score;
      return { ok: true };
    }
    if (pn === "/api/benchmark/score/reset") {
      const mid = (body && body.model_id || "").trim(), dim = (body && body.dim || "").trim();
      if (v7.overrides[mid]) v7.overrides[mid][dim] = "__reset__";
      const baseOv = ((D["/api/benchmark"] || {}).overrides || {})[mid] || {};
      if (dim in baseOv) { v7.overrides[mid] = { ...(v7.overrides[mid] || {}) }; v7.overrides[mid][dim] = "__reset__"; }
      else if (v7.overrides[mid]) delete v7.overrides[mid][dim];
      return { ok: true };
    }
    if (pn === "/api/benchmark/refresh") {
      const d2 = new Date();
      v7.asof = d2.getFullYear() + "-" + String(d2.getMonth() + 1).padStart(2, "0");
      return { ok: true, asof: v7.asof };
    }
    if (pn === "/api/products") {
      const name = (body && body.name || "").trim();
      if (!name || name.length > 15) return { error: "产品名称必填，1-15 字" };
      const pid = "prod-demo-" + Math.random().toString(36).slice(2, 8);
      prodLocal.created.push({ product_id: pid, name, brand_file: (body && body.brand_file) || "brand-tokens.default.json",
        card_ids: (body && body.card_ids) || [], created_at: Date.now() / 1000, mcp_key: "sk-mcp-demo" + Math.random().toString(36).slice(2, 10) });
      return { product_id: pid, mcp_key: prodLocal.created[prodLocal.created.length - 1].mcp_key };
    }
    if (/^\/api\/products\/[^/]+$/.test(pn)) {
      const pid = pn.split("/")[3];
      prodLocal.updated[pid] = { ...(prodLocal.updated[pid] || {}), ...(body || {}) };
      const c = prodLocal.created.find(p => p.product_id === pid);
      if (c) Object.assign(c, body || {});
      return { ok: true };
    }
    if (/^\/api\/products\/[^/]+\/delete$/.test(pn)) {
      const pid = pn.split("/")[3];
      prodLocal.deleted.add(pid);
      prodLocal.created = prodLocal.created.filter(p => p.product_id !== pid);
      return { ok: true };
    }
    if (/^\/api\/cards\/[^/]+\/delete$/.test(pn)) { deadCards.add(pn.split("/")[3]); return { ok: true }; }
    if (pn === "/v1/policies") {
      const pid = "policy-demo-" + Math.random().toString(36).slice(2, 8);
      const apiKey = "sk-route-" + Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 8);
      const created = mergePolicy({ policy_id: pid, name: "未命名策略", route_type: "smart", scope: "custom",
        tenant_id: "tenant-demo", scene: null,
        params: defaultPolicyParams({ route_type: "smart", alpha: 0.5,
          aggregation_weights: { ...SMART_AGGREGATION_WEIGHTS }, allow_cost_effect_preference: false,
          allow_agg_override: 1, default_aggregation: "off" }),
        latency_tier: "balanced", allow_aggregation: 1, explore_ratio: 0.05, model_whitelist: [],
        budget_cap: {}, enabled: 1, ab_group: null, ab_split: 50, version: 1,
        api_key: apiKey, system_preset: 0 }, body);
      created.policy_id = pid;
      created.api_key = apiKey;
      policyState().push(created);
      return { policy_id: pid, api_key: apiKey };
    }
    if (/^\/v1\/policies\/[^/]+\/reset-key$/.test(pn)) {
      const pid = pn.split("/")[3];
      const nk = "sk-route-" + Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 8);
      const policy = policyState().find(p => p.policy_id === pid);
      if (!policy) return { error: "策略不存在" };
      policy.api_key = nk;
      return { ok: true, api_key: nk };
    }
    if (/^\/v1\/policies\/[^/]+\/duplicate$/.test(pn)) {
      const source = policyState().find(p => p.policy_id === pn.split("/")[3]);
      if (!source) return { error: "策略不存在" };
      const copy = JSON.parse(JSON.stringify(source));
      copy.policy_id = "policy-demo-" + Math.random().toString(36).slice(2, 8);
      copy.name = `${source.name || "策略"} 副本`;
      copy.scope = "custom";
      copy.tenant_id = "tenant-demo";
      copy.version = 1;
      copy.api_key = "sk-route-" + Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 8);
      copy.system_preset = 0;
      policyState().push(copy);
      return { policy_id: copy.policy_id, name: copy.name, api_key: copy.api_key };
    }
    if (/^\/v1\/policies\/[^/]+\/delete$/.test(pn)) {
      const pid = pn.split("/")[3];
      const idx = policyState().findIndex(p => p.policy_id === pid);
      if (idx < 0) return { error: "策略不存在" };
      policyState().splice(idx, 1);
      return { ok: true };
    }
    if (/^\/v1\/policies\/[^/]+$/.test(pn)) {
      const pid = pn.split("/")[3];
      const idx = policyState().findIndex(p => p.policy_id === pid);
      if (idx < 0) return { error: "策略不存在" };
      const updated = mergePolicy(policyState()[idx], body);
      updated.policy_id = pid;
      updated.version = (Number(policyState()[idx].version) || 0) + 1;
      policyState()[idx] = updated;
      return { ok: true, version: updated.version, policy: JSON.parse(JSON.stringify(updated)) };
    }
    {
      const mm2 = pn.match(/^\/v1\/models\/([^/]+)\/(set-default|status|thinking|update|profile-data|delete)$/);
      if (mm2) {
        const mid = mm2[1], act = mm2[2];
        if (act === "set-default") { modelLocal.defaultId = mid; return { ok: true }; }
        if (act === "status") { modelLocal.status[mid] = (body && body.status) || "active"; return { ok: true }; }
        if (act === "thinking") { modelLocal.thinking[mid] = !(body && body.enabled === false); return { ok: true }; }
        if (act === "delete") { modelLocal.deleted.add(mid); return { ok: true }; }
        if (act === "update") {
          const patch = {};
          if (body && body.display_name) patch.display_name = body.display_name;
          if (body && body.provider) patch.provider = body.provider;
          modelLocal.updated[mid] = { ...(modelLocal.updated[mid] || {}), ...patch };
          return { ok: true };
        }
        if (act === "profile-data") {
          if (body) {
            const bad = ["price_input", "price_output"].some(k => body[k] != null && !(Number(body[k]) >= 0 && Number(body[k]) <= 10000));
            if (bad) return { error: "单价需在 0 ~ 10000 之间" };
          }
          const u = modelLocal.updated[mid] = { ...(modelLocal.updated[mid] || {}) };
          if (body) {
            if (body.price_input != null) u.price_input = Number(body.price_input) || 0;
            if (body.price_output != null) u.price_output = Number(body.price_output) || 0;
            if (body.deploy_type) u.deploy_type = body.deploy_type;
            if (body.gpu_count != null) u.gpu_count = Number(body.gpu_count) || 0;
            if (u.deploy_type === "self_hosted" && !u.price_input && !u.price_output && u.gpu_count) {
              u.price_input = Math.round(0.15 * u.gpu_count * 100) / 100;
              u.price_output = Math.round(0.30 * u.gpu_count * 100) / 100;
            }
          }
          return { ok: true };
        }
      }
    }
    return { ok: true, demo: true };
  }

  function makeEnvelope(card, source) {
    const cfg = (card.field_bindings || {}).config || {};
    return { schema_version: "1.0.0", render_id: "mk-" + Math.random().toString(36).slice(2, 8),
      component_type: card.component_type, semantic_category: "collect", trigger_source: source || "model_tool_call",
      card_ref: { card_id: card.card_id, version: card.version },
      params: { prompt: (card.text_templates || {}).prompt || card.name,
        reply_text: (card.text_templates || {}).reply || "",
        submit_label: (card.text_templates || {}).submit || "提交",
        options: cfg.options || [], option_meta: cfg.option_meta || {}, option_actions: cfg.option_actions || {},
        display: cfg.display || "", recommended_default: cfg.recommended_default || null,
        fields: cfg.fields || [], likert: cfg.likert || null, slider: cfg.slider || null,
        dimensions: cfg.dimensions || [], values: cfg.values || null, placeholder: cfg.placeholder || "",
        echo_results: false } };
  }

  function matchCard(text) {
    const cards = ((D["/api/cards"] || {}).cards || [])
      .map(c => cardStatus[c.card_id] ? { ...c, status: cardStatus[c.card_id] } : c)
      .filter(c =>
      (c.status === "published" || (c.status === "draft" && c.version >= 1)) &&
      ["collect", "control"].includes(c.semantic_category));
    let best = null;
    for (const c of cards) {
      for (const t of [c.trigger_description || "", ...(c.trigger_examples || [])]) {
        if (!t) continue;
        if (t === text || (t.length >= 5 && (text.includes(t) || t.includes(text)))) { best = c; break; }
      }
      if (best) break;
    }
    return best;
  }

  function sseStream(steps, gap) {
    const enc = new TextEncoder();
    const stream = new ReadableStream({
      start(c) {
        let i = 0;
        const t = setInterval(() => {
          if (i >= steps.length) { clearInterval(t); c.close(); return; }
          c.enqueue(enc.encode("data:" + JSON.stringify(steps[i++]) + "\n\n"));
        }, gap || 420);
      },
    });
    return new Response(stream, { status: 200 });
  }

  function sseRoute(body) {
    const text = (body && body.text) || "";
    // 组件跟进：用户在组件上提交后的续轮
    if (body && body.card_context) {
      return sseStream([
        { step: "final", trace_id: "demo-trace", turn_id: "t-" + Math.random().toString(36).slice(2, 8),
          content: "收到，已按你的选择继续跟进：" + ((body.card_context || {}).summary || "") + "",
          decision_summary: { mode: "auto", switch_result: "fastlane", final_model: "swift-4b", candidates: ["swift-4b"],
            route_layer: "dims", dimensions: ["reasoning"],
            total_cost: 0.0002, total_latency_ms: 380,
            policy: { policy_id: "policy-global-balanced", name: "全局均衡", latency_tier: "balanced", K: 3 } },
          usage: { cost: 0.0002, tokens: 180 } },
      ], 300);
    }
    // 智能交互：命中触发条件 -> 返回组件信封
    if (!(body && body.skip_card_match)) {
      const hit = matchCard(text);
      if (hit) {
        return sseStream([
          { step: "match", text: `触发条件命中：「${hit.name}」` },
          { step: "final", trace_id: "demo-trace", turn_id: "t-" + Math.random().toString(36).slice(2, 8),
            content: "", ask_card: makeEnvelope(hit),
            decision_summary: { mode: "auto", switch_result: "await_user", final_model: null, candidates: [],
              total_cost: 0, total_latency_ms: 120,
              policy: { policy_id: "policy-global-balanced", name: "全局均衡", latency_tier: "balanced", K: 3 } },
            usage: { cost: 0, tokens: 0 } },
        ], 350);
      }
    }
    return sseRouteDemo(body);
  }

  function sseRouteDemo(body) {
    const text = (body && body.text) || "";
    const pid = body && body.policy_id;
    const pol = policyState().find(p => p.policy_id === pid);
    const polMeta = pol ? { policy_id: pol.policy_id, name: pol.name, route_type: pol.route_type || (pol.params || {}).route_type || "smart", latency_tier: pol.latency_tier,
      allow_aggregation: pol.allow_aggregation, K: (pol.params || {}).K || 3, alpha: (pol.params || {}).alpha ?? 0.5,
      router_model: (pol.params || {}).router_model || null, default_aggregation: (pol.params || {}).default_aggregation || "off" }
      : { policy_id: "policy-global-balanced", name: "全局均衡", route_type: "smart", latency_tier: "balanced", allow_aggregation: 1, K: 3, alpha: 0.5, router_model: "swift-4b", default_aggregation: "off" };

    // 手动路由：模拟终端用户选定回答模型，再校验候选范围；不进入智能判维与成本—效果打分。
    if (polMeta.route_type === "manual") {
      const sourceModels=(D["/v1/models"]?.models||[]).filter(m=>m.status==="active"&&modelLocal.status[m.model_id]!=="disabled");
      const allowedIds=pol&&pol.model_whitelist&&pol.model_whitelist.length?pol.model_whitelist:sourceModels.map(m=>m.model_id);
      const requested=((body&&body.answer_models)||[])[0]||(body&&body.manual_model);
      const answerId=allowedIds.includes(requested)?requested:(allowedIds[0]||"swift-4b");
      const answer=sourceModels.find(m=>m.model_id===answerId)||{model_id:answerId,display_name:answerId};
      const aggReq=(body&&body.aggregate)||"auto";
      const effectiveAgg=aggReq==="auto"?polMeta.default_aggregation:aggReq;
      const useAgg=!!(polMeta.allow_aggregation&&effectiveAgg==="on"&&allowedIds.length>1);
      const aggregatorId=useAgg?(allowedIds.find(id=>id!==answerId)||answerId):null;
      const aggregator=sourceModels.find(m=>m.model_id===aggregatorId)||{model_id:aggregatorId,display_name:aggregatorId};
      const steps=[
        {step:"manual_select",text:`手动路由：终端用户选择回答模型 ${answer.display_name||answer.model_id}`},
        {step:"manual_check",text:`候选范围校验通过：${answer.display_name||answer.model_id} 在策略允许的 ${allowedIds.length} 个模型内`},
        {step:useAgg?"switch":"fastlane",text:useAgg?`聚合模型：${aggregator.display_name||aggregator.model_id}`:`回答模型：${answer.display_name||answer.model_id}`},
        {step:"final",trace_id:"demo-trace",turn_id:"t-"+Math.random().toString(36).slice(2,8),
          content:useAgg?"已按终端用户选择调用回答模型，并完成聚合定稿。":"已按终端用户选择的回答模型完成作答。",
          decision_summary:{mode:"manual",switch_result:useAgg?"aggregated":"manual",final_model:answerId,candidates:[answerId],
            aggregator:aggregatorId,dimensions:[],total_cost:useAgg?0.0018:0.0004,total_latency_ms:useAgg?920:460,
            aggregation_default:polMeta.default_aggregation,aggregate_override:aggReq!=="auto"?aggReq:null,
            model_calls:[{model_id:answerId,tokens_in:90,tokens_out:160,tokens_thinking:0,cost:0.0004,latency_ms:460}],policy:polMeta},
          usage:{cost:useAgg?0.0018:0.0004,tokens:250}},
      ];
      return sseStream(steps,380);
    }

    // 硬规则第 1 层：闲聊不判任务画像、不聚合，使用最便宜的回答模型。
    const otherHit = Object.keys(DIM_KEYWORDS).some(d => DIM_KEYWORDS[d].some(w => text.includes(w)))||MULTIMODAL_KEYWORDS.some(w=>text.includes(w));
    if (CHAT_WORDS.some(w => text.includes(w)) && !otherHit && text.length <= 12) {
      return sseStream([
        { step: "rule", text: "日常闲聊不判任务画像；回答模型：迅答 Swift-4B" },
        { step: "final", trace_id: "demo-trace", turn_id: "t-" + Math.random().toString(36).slice(2, 8),
          content: "你好，我是本平台的智能助手，可以协助你做分析、写作、代码等多类问题。",
          decision_summary: { mode: "auto", switch_result: "fastlane", final_model: "swift-4b", candidates: ["swift-4b"],
            route_layer: "rule", dimensions: [],
            total_cost: 0.0001, total_latency_ms: 320,
            model_calls: [{ model_id: "swift-4b", tokens_in: 30, tokens_out: 60, tokens_thinking: 0, cost: 0.0001, latency_ms: 320 }],
            policy: polMeta },
          usage: { cost: 0.0001, tokens: 90 } },
      ], 400);
    }

    // 硬依赖：未配置智能路由模型 → 使用兜底回答模型
    const routerModelId=polMeta.router_model||(v7.router&&v7.router.model_id);
    if (!routerModelId) {
      return sseStream([
        { step: "rule", text: "未配置智能路由模型，无法识别任务画像；回答模型：衡岳 Atlas-72B（兜底）" },
        { step: "final", trace_id: "demo-trace", turn_id: "t-" + Math.random().toString(36).slice(2, 8),
          content: "（兜底模型示例回答）围绕这个问题，可以从现状、约束与可行动作三个层面展开分析。",
          decision_summary: { mode: "auto", switch_result: "fallback", final_model: "atlas-72b", candidates: ["atlas-72b"],
            route_layer: "no_router", dimensions: [], total_cost: 0.0005, total_latency_ms: 640,
            model_calls: [{ model_id: "atlas-72b", tokens_in: 90, tokens_out: 160, tokens_thinking: 0, cost: 0.0005, latency_ms: 640 }],
            policy: polMeta },
          usage: { cost: 0.0005, tokens: 250 } },
      ], 420);
    }

    const dims = classifyDims(text);
    const isMM = MULTIMODAL_KEYWORDS.some(w=>text.includes(w));
    const bm = benchState();
    let models = bm.models.filter(m => modelLocal.status[m.model_id] !== "disabled");
    const steps = [];
    if (isMM) {
      models = models.filter(m => (m.capabilities || {}).vision);
      steps.push({ step: "rule", text: `第 1 层 · 硬规则命中：多模态请求，仅在 ${models.length} 个支持图像的模型中路由` });
    }
    const configuredRouter=(D["/v1/models"]?.models||[]).find(m=>m.model_id===routerModelId);
    const rname=configuredRouter?.display_name||(v7.router&&v7.router.display_name)||routerModelId;
    steps.push({ step: "dims", text: `路由器模型 ${rname} 识别任务画像：「${dims.map(d => DIM_CN[d] || d).join("、")}」（180ms · ¥0.0001）`, dims });

    // 综合分：判定维度平均得分 × 权重 + 省钱分 ×（1 - 权重）
    const inv = {}; let lo = Infinity, hi = -Infinity;
    models.forEach(m => { const v = 1 / Math.max(0.01, (m.price_input || 0) + (m.price_output || 0));
      inv[m.model_id] = v; lo = Math.min(lo, v); hi = Math.max(hi, v); });
    const alpha = polMeta.alpha;
    const ranked = [];
    let savedProfiles = {};
    try { savedProfiles = JSON.parse(localStorage.getItem("router-demo-model-profiles-v8") || "{}"); } catch (_e) {}
    models.forEach(m => {
      const vals = dims.map(d => {
        const configured=savedProfiles[m.model_id]?.quality?.[d];
        if(configured!=null)return Number(configured)*100;
        return (bm.scores[m.model_id] || {})[QUALITY_TO_BENCH[d]];
      }).filter(v => v != null);
      if (!vals.length) return;
      const perf = vals.reduce((a, b) => a + b, 0) / vals.length / 100;
      const eff = hi > lo ? (inv[m.model_id] - lo) / (hi - lo) : 0.5;
      ranked.push([m.model_id, Math.round((alpha * perf + (1 - alpha) * eff) * 1000) / 1000, m.display_name]);
    });
    ranked.sort((a, b) => b[1] - a[1]);
    if (!ranked.length) {
      steps.push({ step: "rule", text: "候选模型在任务画像维度上均无得分；回答模型：衡岳 Atlas-72B（兜底）" });
      steps.push({ step: "final", trace_id: "demo-trace", turn_id: "t-" + Math.random().toString(36).slice(2, 8),
        content: "（兜底模型示例回答）已按现有能力尽力作答。",
        decision_summary: { mode: "auto", switch_result: "fallback", final_model: "atlas-72b", candidates: ["atlas-72b"],
          route_layer: "else", dimensions: dims, total_cost: 0.0005, total_latency_ms: 640,
          model_calls: [{ model_id: "atlas-72b", tokens_in: 90, tokens_out: 140, tokens_thinking: 0, cost: 0.0005, latency_ms: 640 }],
          policy: polMeta },
        usage: { cost: 0.0005, tokens: 230 } });
      return sseStream(steps, 420);
    }
    const scoreMap = {};
    ranked.forEach(r => { scoreMap[r[0]] = r[1]; });
    const qualityWeight=alpha,cheapWeight=Math.round((1-alpha)*10)/10;
    const strategyText=alpha<=0.2
      ? `质量分权重 ${qualityWeight}、便宜分权重 ${cheapWeight}，优先选择低成本模型`
      : alpha>=0.8
        ? `质量分权重 ${qualityWeight}、便宜分权重 ${cheapWeight}，优先选择高质量模型`
        : `质量分权重 ${qualityWeight}、便宜分权重 ${cheapWeight}，平衡效果与成本`;
    steps.push({ step: "coarse", text: strategyText, scores: scoreMap });

    const aggReq = (body && body.aggregate) || "auto";
    const effectiveAgg = aggReq === "auto" ? polMeta.default_aggregation : aggReq;
    const overrideDenied = aggReq === "on" && pol && ((pol.params || {}).allow_agg_override === 0);
    const t = pol ? ((pol.params || {}).t ?? 0.8) : 0.8;
    const gapClose = ranked.length >= 2 && ranked[0][1] - ranked[1][1] < Math.max(0.02, (1 - t) * 0.3);
    const canAgg = (pol ? pol.allow_aggregation : 1) && effectiveAgg !== "off" && !overrideDenied;
    const forceAgg = effectiveAgg === "on" && !overrideDenied && ranked.length >= 2;
    const doAgg = ranked.length >= 2 && canAgg && (gapClose || forceAgg);
    const top = ranked[0];

    if (!doAgg) {
      steps.push({ step: "fastlane", text: `回答模型：${top[2]}` });
      steps.push({ step: "final", trace_id: "demo-trace", turn_id: "t-" + Math.random().toString(36).slice(2, 8),
        content: isMM ? "已识别图像内容：箱号 TEMU1203987，箱体完好无明显破损。"
          : "结论先行：整体趋势上行，建议优先关注供给端节奏，必要时再拆分区域看结构差异。",
        decision_summary: { mode: "auto", switch_result: "fastlane", final_model: top[0], candidates: [top[0]],
          route_layer: isMM ? "rule" : "dims", dimensions: dims,
          aggregation_default:polMeta.default_aggregation,aggregate_override: aggReq !== "auto" ? aggReq : null, aggregate_override_denied: overrideDenied,
          total_cost: 0.0021, total_latency_ms: 780,
          model_calls: [{ model_id: top[0], tokens_in: 120, tokens_out: 190, tokens_thinking: 0, cost: 0.0021, latency_ms: 780 }],
          policy: polMeta },
        usage: { cost: 0.0021, tokens: 310 } });
      return sseStream(steps, 400);
    }
    const second = ranked[1];
    steps.push({ step: "calling", text: forceAgg && !gapClose ? `${aggReq==="auto"?"策略默认聚合":"本次请求选择聚合"}：2 个候选并发作答` : "综合分接近：2 个候选并发作答",
      models: [{ id: top[0], name: top[2] }, { id: second[0], name: second[2] }] });
    steps.push({ step: "switch", text: `保留 2 份回答，交给聚合模型 ${top[2]} 总结定稿`, result: "aggregated" });
    steps.push({ step: "final", trace_id: "demo-trace", turn_id: "t-" + Math.random().toString(36).slice(2, 8),
      content: "综合 2 个候选模型的回答并交叉验证：近八周价格整体呈上行趋势，建议关注供需两端的边际变化。",
      components: [{ schema_version: "1.0.0", render_id: "demo-pref", component_type: "feedback.preference",
        semantic_category: "evaluate", trigger_source: "system_injected", card_ref: null,
        params: { candidates: [
          { model_id: top[0], alias: "候选1", content: "近八周价格上行，涨幅 22%，动力来自供给收缩。" },
          { model_id: second[0], alias: "候选2", content: "价格中枢上移，建议关注库存与需求端边际变化。" }] } }],
      decision_summary: { mode: "auto", switch_result: "aggregated", final_model: top[0],
        candidates: [top[0], second[0]], aggregator: top[0],
        route_layer: isMM ? "rule" : "dims", dimensions: dims,
        aggregation_default:polMeta.default_aggregation,aggregate_override: aggReq !== "auto" ? aggReq : null, aggregate_override_denied: false,
        total_cost: 0.0083, total_latency_ms: 1240,
        model_calls: [
          { model_id: top[0], tokens_in: 120, tokens_out: 260, tokens_thinking: 0, cost: 0.0047, latency_ms: 980 },
          { model_id: second[0], tokens_in: 120, tokens_out: 210, tokens_thinking: 0, cost: 0.0036, latency_ms: 860 }],
        policy: polMeta },
      usage: { cost: 0.0083, tokens: 1060 } });
    return sseStream(steps, 420);
  }

  window.fetch = function (url, opts = {}) {
    let u = String(url);
    // 任意形式（完整 URL / 相对路径）归一化成 /api 或 /v1 开头的路径
    try {
      const parsed = new URL(u, location.href);
      if (parsed.origin === location.origin) {
        const i = parsed.pathname.search(/\/(api|v1)\//);
        if (i >= 0) u = parsed.pathname.slice(i) + parsed.search;
      }
    } catch (e) {}
    const isApi = u.startsWith("/api") || u.startsWith("/v1");
    if (!isApi) return realFetch(url, opts);
    const method = (opts.method || "GET").toUpperCase();
    const pn = u.split("?")[0];
    let body = null;
    if (opts.body) { try { body = JSON.parse(opts.body); } catch (e) {} }
    if (pn === "/v1/route") return Promise.resolve(sseRoute(body));
    if (method === "GET") return Promise.resolve(json(getMock(pn, u)));
    return Promise.resolve(json(postMock(pn, body)));
  };
})();
