import { useState } from "react";

const spec = {
  title: "Zepto Search Scraping — Agent Spec",
  version: "v1.0",
  sections: [
    {
      id: "endpoint",
      label: "01 — Endpoints",
      color: "#00C2A8",
      items: [
        {
          title: "Store Resolution (Run First)",
          type: "GET",
          url: "https://api.zeptonow.com/api/v2/store/select/?latitude={LAT}&longitude={LNG}",
          note: "Must be called before any search. Returns storeId and societyId tied to user's location.",
          extract: ["store_id", "society_id", "store_name", "serviceable"]
        },
        {
          title: "Primary Search",
          type: "POST",
          url: "https://api.zeptonow.com/api/v3/search",
          note: "Main search endpoint. Requires storeId resolved above.",
          extract: ["sections[].items[]", "product_id", "name", "mrp", "discounted_price", "available"]
        },
        {
          title: "Session Validation",
          type: "GET",
          url: "https://api.zeptonow.com/api/v2/user/profile/",
          note: "Run before search to confirm session is alive. Zepto returns bad results silently on expired tokens — not a 401.",
          extract: ["user_id", "phone", "token_valid"]
        }
      ]
    },
    {
      id: "headers",
      label: "02 — Required Headers",
      color: "#FF6B35",
      items: [
        { key: "Content-Type", value: "application/json", critical: false },
        { key: "authorization", value: "Bearer <session_token>", critical: true },
        { key: "storeid", value: "<store_id from /store/select/>", critical: true },
        { key: "x-store-id", value: "<same store_id — Zepto checks both>", critical: true },
        { key: "societyid", value: "<society_id from /store/select/>", critical: true },
        { key: "requestid", value: "<fresh UUID v4 — MUST be unique per request>", critical: true },
        { key: "platform", value: "web", critical: false },
        { key: "appversion", value: "11.xx.x (use latest valid version)", critical: false },
        { key: "x-latitude", value: "<user lat>", critical: false },
        { key: "x-longitude", value: "<user lng>", critical: false }
      ]
    },
    {
      id: "payload",
      label: "03 — Request Payload",
      color: "#A855F7",
      code: `{
  "query": "<search_term>",
  "page_number": 0,
  "search_meta_data": {
    "is_primary_search": true,
    "search_type": "TEXT",
    "intent": "PRODUCT"
  }
}`,
      notes: [
        "search_type options: TEXT | VOICE | BARCODE",
        "page_number is 0-indexed",
        "search_meta_data is mandatory — missing it breaks result ranking",
        "Do NOT reuse payloads; always regenerate requestId in headers"
      ]
    },
    {
      id: "flow",
      label: "04 — Execution Flow",
      color: "#F59E0B",
      steps: [
        { step: 1, action: "Capture session from user app", detail: "Extract: token, lat, lng, storeId (if available)" },
        { step: 2, action: "Validate session", detail: "GET /user/profile/ → if fail, re-authenticate before continuing" },
        { step: 3, action: "Resolve store", detail: "GET /store/select/?lat=&lng= → extract storeId + societyId" },
        { step: 4, action: "Build headers", detail: "Set storeid, x-store-id, societyid, authorization, fresh requestId (UUID v4)" },
        { step: 5, action: "POST search", detail: "POST /api/v3/search with query + search_meta_data payload" },
        { step: 6, action: "Parse response", detail: "response.data.sections[].items[] → filter by productResponse.product" },
        { step: 7, action: "Repeat with new requestId", detail: "Each subsequent search must have a freshly generated UUID" }
      ]
    },
    {
      id: "parsing",
      label: "05 — Response Parsing",
      color: "#10B981",
      code: `// Zepto nests products inside sections[]
const products = response.data.sections
  .flatMap(section => section.items || [])
  .filter(item => item?.productResponse?.product)
  .map(item => {
    const p = item.productResponse.product;
    const store = item.productResponse.storeSpecificData?.[0];
    return {
      product_id:        p.id,
      name:              p.name,
      brand:             p.brand,
      mrp:               store?.mrp,
      discounted_price:  store?.discountedSellingPrice,
      discount_percent:  store?.discountPercent,
      available:         store?.available,
      quantity:          p.unitQuantity + " " + p.unitType,
      image_url:         p.imgUrl,
      category:          p.category
    };
  });`,
      notes: [
        "sections[] may include banners/ads — filter by productResponse.product",
        "storeSpecificData[0] holds pricing and availability (store-level)",
        "available: false means out of stock at that dark store"
      ]
    },
    {
      id: "errors",
      label: "06 — Failure Modes",
      color: "#EF4444",
      items: [
        { issue: "Empty or irrelevant results", cause: "Stale storeId or missing societyId", fix: "Re-call /store/select/ before every session" },
        { issue: "Silent bad results (no error)", cause: "Expired session token", fix: "Always validate /user/profile/ first" },
        { issue: "Duplicate results", cause: "Reused requestId across calls", fix: "Generate fresh UUID v4 per request" },
        { issue: "Missing prices", cause: "storeSpecificData[] is empty array", fix: "Check store serviceability for user's location" },
        { issue: "401 Unauthorized", cause: "Token invalid or not passed correctly", fix: "Bearer prefix must be present in authorization header" },
        { issue: "Wrong products for location", cause: "storeId from old session", fix: "Always resolve storeId from current user lat/lng" }
      ]
    },
    {
      id: "compare",
      label: "07 — Zepto vs BigBasket",
      color: "#6366F1",
      rows: [
        ["Factor", "BigBasket", "Zepto"],
        ["API Style", "REST (simple)", "REST + strict headers"],
        ["Auth Failure", "Returns 401", "Silent garbage results"],
        ["Location Dep.", "Moderate", "Hyper-local (storeId required)"],
        ["Request ID", "Not needed", "Mandatory, must be unique UUID"],
        ["Search Payload", "q=keyword", "JSON body + search_meta_data"],
        ["Result Structure", "Flat product list", "Nested under sections[]"],
        ["Token Expiry Signal", "Clear error", "Empty/irrelevant results"]
      ]
    }
  ]
};

export default function ZeptoSpec() {
  const [active, setActive] = useState("endpoint");
  const [copied, setCopied] = useState(null);

  const activeSection = spec.sections.find(s => s.id === active);

  const copy = (text, id) => {
    navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 1800);
  };

  return (
    <div style={{
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      background: "#0D0D0F",
      minHeight: "100vh",
      color: "#E2E8F0",
      display: "flex",
      flexDirection: "column"
    }}>
      {/* Header */}
      <div style={{
        borderBottom: "1px solid #1E2030",
        padding: "20px 28px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        background: "#0D0D0F"
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8,
            background: "linear-gradient(135deg, #00C2A8, #6366F1)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 14, fontWeight: 700
          }}>Z</div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.05em", color: "#F1F5F9" }}>
              {spec.title}
            </div>
            <div style={{ fontSize: 10, color: "#475569", letterSpacing: "0.08em" }}>
              AGENT-READY SPEC · {spec.version}
            </div>
          </div>
        </div>
        <div style={{
          fontSize: 10, color: "#00C2A8", background: "#00C2A820",
          padding: "4px 10px", borderRadius: 20, border: "1px solid #00C2A830",
          letterSpacing: "0.1em"
        }}>QUICK COMMERCE</div>
      </div>

      <div style={{ display: "flex", flex: 1 }}>
        {/* Sidebar */}
        <div style={{
          width: 200, borderRight: "1px solid #1E2030",
          padding: "16px 0", flexShrink: 0
        }}>
          {spec.sections.map(s => (
            <button key={s.id} onClick={() => setActive(s.id)} style={{
              display: "block", width: "100%", textAlign: "left",
              padding: "10px 20px", background: active === s.id ? "#1E2030" : "transparent",
              border: "none", cursor: "pointer",
              borderLeft: active === s.id ? `2px solid ${s.color}` : "2px solid transparent",
              color: active === s.id ? "#F1F5F9" : "#64748B",
              fontSize: 10, letterSpacing: "0.06em",
              transition: "all 0.15s"
            }}>
              {s.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div style={{ flex: 1, padding: "24px 28px", overflowY: "auto" }}>
          <div style={{
            display: "flex", alignItems: "center", gap: 10, marginBottom: 24
          }}>
            <div style={{
              width: 4, height: 20, borderRadius: 2,
              background: activeSection.color
            }} />
            <h2 style={{ margin: 0, fontSize: 13, fontWeight: 700, color: "#F1F5F9", letterSpacing: "0.05em" }}>
              {activeSection.label}
            </h2>
          </div>

          {/* ENDPOINTS */}
          {activeSection.id === "endpoint" && activeSection.items.map((ep, i) => (
            <div key={i} style={{
              background: "#13141A", border: "1px solid #1E2030",
              borderRadius: 10, padding: 18, marginBottom: 14
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                <span style={{
                  fontSize: 9, fontWeight: 700, padding: "3px 8px", borderRadius: 4,
                  background: ep.type === "POST" ? "#A855F720" : "#10B98120",
                  color: ep.type === "POST" ? "#A855F7" : "#10B981",
                  border: `1px solid ${ep.type === "POST" ? "#A855F740" : "#10B98140"}`
                }}>{ep.type}</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: "#F1F5F9" }}>{ep.title}</span>
              </div>
              <div style={{
                background: "#0D0D0F", borderRadius: 6, padding: "10px 14px",
                fontSize: 10, color: "#00C2A8", marginBottom: 10,
                display: "flex", justifyContent: "space-between", alignItems: "center",
                border: "1px solid #1E2030"
              }}>
                <span style={{ wordBreak: "break-all" }}>{ep.url}</span>
                <button onClick={() => copy(ep.url, `url-${i}`)} style={{
                  background: "none", border: "none", cursor: "pointer",
                  color: copied === `url-${i}` ? "#10B981" : "#475569",
                  fontSize: 11, marginLeft: 8, flexShrink: 0
                }}>{copied === `url-${i}` ? "✓" : "⎘"}</button>
              </div>
              <div style={{ fontSize: 10, color: "#94A3B8", marginBottom: 10 }}>↳ {ep.note}</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                <span style={{ fontSize: 9, color: "#475569" }}>EXTRACT:</span>
                {ep.extract.map((e, j) => (
                  <span key={j} style={{
                    fontSize: 9, padding: "2px 7px", borderRadius: 3,
                    background: "#1E2030", color: "#94A3B8", fontFamily: "inherit"
                  }}>{e}</span>
                ))}
              </div>
            </div>
          ))}

          {/* HEADERS */}
          {activeSection.id === "headers" && (
            <div style={{ background: "#13141A", border: "1px solid #1E2030", borderRadius: 10, overflow: "hidden" }}>
              {activeSection.items.map((h, i) => (
                <div key={i} style={{
                  display: "flex", alignItems: "center",
                  padding: "11px 18px",
                  borderBottom: i < activeSection.items.length - 1 ? "1px solid #1E2030" : "none",
                  background: h.critical ? "#FF6B3508" : "transparent"
                }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", marginRight: 12, flexShrink: 0,
                    background: h.critical ? "#FF6B35" : "#334155"
                  }} />
                  <span style={{ fontSize: 10, color: "#F1F5F9", width: 160, flexShrink: 0 }}>{h.key}</span>
                  <span style={{ fontSize: 10, color: "#64748B", flex: 1 }}>{h.value}</span>
                  {h.critical && (
                    <span style={{
                      fontSize: 8, color: "#FF6B35", background: "#FF6B3515",
                      padding: "2px 7px", borderRadius: 3, border: "1px solid #FF6B3530",
                      letterSpacing: "0.08em"
                    }}>CRITICAL</span>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* PAYLOAD */}
          {activeSection.id === "payload" && (
            <>
              <div style={{
                background: "#13141A", border: "1px solid #1E2030", borderRadius: 10,
                overflow: "hidden", marginBottom: 16
              }}>
                <div style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  padding: "10px 16px", borderBottom: "1px solid #1E2030",
                  background: "#0D0D0F"
                }}>
                  <span style={{ fontSize: 10, color: "#475569", letterSpacing: "0.08em" }}>REQUEST BODY · JSON</span>
                  <button onClick={() => copy(activeSection.code, "payload")} style={{
                    background: "none", border: "none", cursor: "pointer",
                    color: copied === "payload" ? "#10B981" : "#475569",
                    fontSize: 11
                  }}>{copied === "payload" ? "✓ copied" : "⎘ copy"}</button>
                </div>
                <pre style={{
                  margin: 0, padding: "16px 18px",
                  fontSize: 11, color: "#A855F7", lineHeight: 1.7,
                  overflowX: "auto"
                }}>{activeSection.code}</pre>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {activeSection.notes.map((n, i) => (
                  <div key={i} style={{
                    display: "flex", gap: 10, fontSize: 10, color: "#94A3B8",
                    padding: "8px 14px", background: "#13141A",
                    borderRadius: 6, border: "1px solid #1E2030"
                  }}>
                    <span style={{ color: "#F59E0B" }}>!</span> {n}
                  </div>
                ))}
              </div>
            </>
          )}

          {/* FLOW */}
          {activeSection.id === "flow" && (
            <div style={{ position: "relative" }}>
              {activeSection.steps.map((s, i) => (
                <div key={i} style={{ display: "flex", gap: 16, marginBottom: 16 }}>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                    <div style={{
                      width: 28, height: 28, borderRadius: "50%", flexShrink: 0,
                      background: `${activeSection.color}20`,
                      border: `1px solid ${activeSection.color}60`,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: 10, fontWeight: 700, color: activeSection.color
                    }}>{s.step}</div>
                    {i < activeSection.steps.length - 1 && (
                      <div style={{ width: 1, flex: 1, background: "#1E2030", margin: "4px 0" }} />
                    )}
                  </div>
                  <div style={{
                    flex: 1, background: "#13141A", border: "1px solid #1E2030",
                    borderRadius: 8, padding: "12px 16px", marginBottom: 4
                  }}>
                    <div style={{ fontSize: 11, fontWeight: 600, color: "#F1F5F9", marginBottom: 4 }}>{s.action}</div>
                    <div style={{ fontSize: 10, color: "#64748B" }}>{s.detail}</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* PARSING */}
          {activeSection.id === "parsing" && (
            <>
              <div style={{
                background: "#13141A", border: "1px solid #1E2030", borderRadius: 10,
                overflow: "hidden", marginBottom: 16
              }}>
                <div style={{
                  display: "flex", justifyContent: "space-between", alignItems: "center",
                  padding: "10px 16px", borderBottom: "1px solid #1E2030", background: "#0D0D0F"
                }}>
                  <span style={{ fontSize: 10, color: "#475569", letterSpacing: "0.08em" }}>RESPONSE PARSER · JAVASCRIPT</span>
                  <button onClick={() => copy(activeSection.code, "parse")} style={{
                    background: "none", border: "none", cursor: "pointer",
                    color: copied === "parse" ? "#10B981" : "#475569", fontSize: 11
                  }}>{copied === "parse" ? "✓ copied" : "⎘ copy"}</button>
                </div>
                <pre style={{
                  margin: 0, padding: "16px 18px",
                  fontSize: 11, color: "#10B981", lineHeight: 1.7,
                  overflowX: "auto"
                }}>{activeSection.code}</pre>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {activeSection.notes.map((n, i) => (
                  <div key={i} style={{
                    display: "flex", gap: 10, fontSize: 10, color: "#94A3B8",
                    padding: "8px 14px", background: "#13141A",
                    borderRadius: 6, border: "1px solid #1E2030"
                  }}>
                    <span style={{ color: "#10B981" }}>→</span> {n}
                  </div>
                ))}
              </div>
            </>
          )}

          {/* ERRORS */}
          {activeSection.id === "errors" && activeSection.items.map((e, i) => (
            <div key={i} style={{
              background: "#13141A", border: "1px solid #1E2030",
              borderLeft: `3px solid #EF4444`,
              borderRadius: 8, padding: "14px 16px", marginBottom: 12
            }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: "#FCA5A5", marginBottom: 6 }}>⚠ {e.issue}</div>
              <div style={{ display: "flex", gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 9, color: "#475569", width: 50, flexShrink: 0, paddingTop: 1 }}>CAUSE</span>
                <span style={{ fontSize: 10, color: "#94A3B8" }}>{e.cause}</span>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <span style={{ fontSize: 9, color: "#475569", width: 50, flexShrink: 0, paddingTop: 1 }}>FIX</span>
                <span style={{ fontSize: 10, color: "#10B981" }}>{e.fix}</span>
              </div>
            </div>
          ))}

          {/* COMPARE TABLE */}
          {activeSection.id === "compare" && (
            <div style={{
              background: "#13141A", border: "1px solid #1E2030",
              borderRadius: 10, overflow: "hidden"
            }}>
              {activeSection.rows.map((row, i) => (
                <div key={i} style={{
                  display: "grid", gridTemplateColumns: "1.5fr 1fr 1fr",
                  borderBottom: i < activeSection.rows.length - 1 ? "1px solid #1E2030" : "none",
                  background: i === 0 ? "#0D0D0F" : "transparent"
                }}>
                  {row.map((cell, j) => (
                    <div key={j} style={{
                      padding: "11px 16px",
                      fontSize: i === 0 ? 9 : 10,
                      fontWeight: i === 0 ? 700 : 400,
                      color: i === 0 ? "#475569" : j === 0 ? "#94A3B8" : j === 1 ? "#64748B" : "#F1F5F9",
                      letterSpacing: i === 0 ? "0.08em" : 0,
                      borderRight: j < 2 ? "1px solid #1E2030" : "none"
                    }}>{cell}</div>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
