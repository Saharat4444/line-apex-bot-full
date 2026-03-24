require('dotenv').config();
const express = require('express');
const axios = require('axios');
const { GoogleAuth } = require('google-auth-library');

const app = express();
app.use(express.json());

const APEX_BASE = 'https://uatonline.hutchisonports.co.th/hptuat/api/linebot';

/* =====================================================
   LOGGER
===================================================== */
function log(title, data = null) {
  console.log("\n===============================");
  console.log(`🔎 ${title}`);
  if (data) console.log(JSON.stringify(data, null, 2));
  console.log("===============================\n");
}
function logError(error) {
  console.log("\n❌ ERROR ======================");
  console.log(error.response?.data || error.message);
  console.log("===============================\n");
}

/* =====================================================
   DIALOGFLOW CONFIG
===================================================== */
const authFlex = new GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS_FLEX),
  scopes: 'https://www.googleapis.com/auth/dialogflow'
});
const authFAQ = new GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_CREDENTIALS_FAQ),
  scopes: 'https://www.googleapis.com/auth/dialogflow'
});

async function detectIntent(projectId, authClient, text, sessionId, languageCode) {
  try {
    const client = await authClient.getClient();
    const accessToken = await client.getAccessToken();
    const response = await axios.post(
      `https://dialogflow.googleapis.com/v2/projects/${projectId}/agent/sessions/${sessionId}:detectIntent`,
      { queryInput: { text: { text, languageCode } } },
      { headers: { Authorization: `Bearer ${accessToken.token}`, "Content-Type": "application/json" } }
    );
    const result = response.data.queryResult;
    log("DIALOGFLOW SUMMARY", {
      intent:      result.intent?.displayName,
      confidence:  result.intentDetectionConfidence,
      fulfillment: result.fulfillmentText
    });
    return result;
  } catch (err) { logError(err); throw err; }
}

function isFallback(result) {
  return (result.intent?.displayName || '').toLowerCase().includes('fallback');
}

/* =====================================================
   DETECT SEARCH TYPE
===================================================== */
function detectSearchType(text) {
  const upper = text.toUpperCase().trim();

  // Container: 4 ตัวอักษร + 7 ตัวเลข (รวม 11 ตัว)
  const containerMatch = upper.match(/\b([A-Z]{4}[0-9]{7})\b/);
  if (containerMatch) return { type: 'container', value: containerMatch[1] };

  // Vessel: "เรือ xxx" หรือ "vessel xxx"
  if (/^(เรือ|vessel)\s+/i.test(text.trim())) {
    const shipName = text.trim().replace(/^(เรือ|vessel)\s+/i, '').trim();
    if (shipName) return { type: 'vessel', value: shipName };
  }

  // Booking/BL: "booking xxx" หรือ "bl xxx" หรือ pattern BKKxxxxxxxx
  if (/^(booking|bl)\s+/i.test(text.trim())) {
    const bookNo = text.trim().replace(/^(booking|bl)\s+/i, '').trim();
    if (bookNo) return { type: 'booking', value: bookNo };
  }
  const bookingMatch = upper.match(/^([A-Z]{2,4}[0-9]{6,10})$/);
  if (bookingMatch) return { type: 'booking', value: bookingMatch[1] };

  return { type: 'dialogflow', value: text };
}

/* =====================================================
   FETCH FROM APEX
===================================================== */
async function fetchApex(endpoint) {
  try {
    const url = `${APEX_BASE}/${endpoint}`;
    log("APEX REQUEST", url);
    const resp = await axios.get(url, { timeout: 8000 });
    return resp.data;
  } catch (err) { logError(err); return null; }
}

function getFirstItem(apexData) {
  if (!apexData) return null;
  if (Array.isArray(apexData.items) && apexData.items.length > 0) return apexData.items[0];
  if (Array.isArray(apexData) && apexData.length > 0) return apexData[0];
  return null;
}

/* =====================================================
   FLEX CARD HELPERS
===================================================== */
function row(label, value) {
  return {
    type: "box", layout: "horizontal",
    contents: [
      { type: "text", text: label,        size: "sm", color: "#aaaaaa", flex: 4 },
      { type: "text", text: value || "-", size: "sm", weight: "bold", color: "#333333", flex: 6, wrap: true }
    ]
  };
}

/* =====================================================
   CARD 1 & 2 — Container detail
   ใช้ column จาก NEDR_CNTR_DETAIL_TRUCK_SN:
     CNTR_ID, TRANS_TYPE, SIZE_ID, TYPE_ID, HEIGHT_ID,
     STATUS, LOC, VESSEL, VOYAGE (computed),
     LINE_ID, BL_NO, BOOK_NO,
     HOME_BERTH_TML, ACCOUNT_STATUS, VALID_BEFORE
===================================================== */
function buildContainerFlex(d) {
  const isImport = (d.trans_type || '').toUpperCase() === 'IMPORT';
  const size     = [d.size_id, d.type_id, d.height_id].filter(Boolean).join('/') || '-';

  return {
    type: "bubble", size: "mega",
    body: {
      type: "box", layout: "vertical", spacing: "md", paddingAll: "20px",
      contents: [
        { type: "text", text: "Container detail", weight: "bold", size: "sm", color: "#333333" },
        { type: "text", text: d.cntr_id || "-", weight: "bold", size: "xxl", wrap: true },
        { type: "separator", margin: "md" },
        {
          type: "box", layout: "vertical", margin: "md", spacing: "sm",
          contents: [
            row("Sz/Ty/Ht :",      size),
            row("Category :",      d.trans_type),
            row("Status :",        d.status),
            row("Location :",      d.loc),
            row("Vessel :",        d.vessel),
            row("Voyage :",        d.voyage),                         // CASE IN/OUT_SHIP_VOY
            row("Line :",          d.line_id),
            isImport
              ? row("Booking :",        d.book_no)                    // BOOK_NO (IMPORT)
              : row("Bill of Lading :", d.bl_no),                     // BL_NO (EXPORT)
            row("Home Berthing :", d.home_berth_tml),                 // HOME_BERTH_TML
            row("Hold Status :",   d.account_status),                 // ACCOUNT_STATUS
            row("PVB :",           d.valid_before),                   // VALID_BEFORE
          ]
        },
        { type: "text", text: "PVB : Payment Valid Before", size: "xs", color: "#aaaaaa", margin: "md" }
      ]
    },
    footer: {
      type: "box", layout: "vertical", paddingAll: "10px",
      contents: [{
        type: "button", style: "secondary", color: "#eeeeee",
        action: { type: "postback", label: "Check another container", data: "action=container" }
      }]
    }
  };
}

/* =====================================================
   CARD 3 — Vessel Schedule
   ใช้ column จาก NEDR_VESSEL_SCHEDULE_SN:
     SHIP_NAME, IN_VOY_NBR→VOYAGE_CODE,
     BILLING_TERMINAL→TERMINAL,
     ETA, DEP→ETD,
     CARGO_CUTOFF→CLOSING_TIME,
     ARR_STATUS→CURRENTLY_IN_PORT,
     BERTH
   ** ไม่มี SHIPPING_AGENT ในตาราง → ซ่อน field นี้ **
===================================================== */
function buildVesselFlex(d) {
  return {
    type: "bubble", size: "mega",
    body: {
      type: "box", layout: "vertical", spacing: "md", paddingAll: "20px",
      contents: [
        { type: "text", text: "Vessel Schedule", weight: "bold", size: "sm", color: "#333333" },
        { type: "text", text: d.ship_name || "-", weight: "bold", size: "xxl", wrap: true },
        { type: "separator", margin: "md" },
        {
          type: "box", layout: "vertical", margin: "md", spacing: "sm",
          contents: [
            row("Voyage Code :",         d.voyage_code),              // IN_VOY_NBR
            row("Arrives in Terminal :", d.terminal),                 // BILLING_TERMINAL
            row("Estimated Arrival :",   d.eta),                      // ETA
            row("Estimated Departure :", d.dep),                      // DEP
            row("Closing :",             d.closing_time),             // CARGO_CUTOFF
            row("Currently in Port :",   d.currently_in_port),        // ARR_STATUS
            row("Berth :",               d.berth),                    // BERTH
          ]
        }
      ]
    },
    footer: {
      type: "box", layout: "vertical", paddingAll: "10px",
      contents: [{
        type: "button", style: "secondary", color: "#eeeeee",
        action: { type: "postback", label: "Check another vessel", data: "action=vessel" }
      }]
    }
  };
}

/* =====================================================
   CARD 5 — Booking
   ใช้ column จาก NEDR_BOOK_BL_VW_SN (GROUP BY):
     BOOK_NO_QUERY, BL_NO_QUERY, CATEGORY,
     IN_SHIP_NAME / OUT_SHIP_NAME → vessel
     IN_SHIP_VOY  / OUT_SHIP_VOY  → voyage
     CUSTOMER → ชื่อลูกค้า
     COUNT(CNTR_NBR) → CONTAINER_COUNT
   ** ไม่มี BOOKING_CREATED → ซ่อน field นี้ **
===================================================== */
function buildBookingFlex(d) {
  const isImport = (d.category || '').toUpperCase() === 'IMPORT';
  const vessel   = isImport ? d.in_ship_name  : d.out_ship_name;
  const voyage   = isImport ? d.in_ship_voy   : d.out_ship_voy;

  return {
    type: "bubble", size: "mega",
    body: {
      type: "box", layout: "vertical", spacing: "md", paddingAll: "20px",
      contents: [
        { type: "text", text: "Booking", weight: "bold", size: "sm", color: "#333333" },
        { type: "text", text: d.book_no_query || "-", weight: "bold", size: "xxl", wrap: true },
        { type: "separator", margin: "md" },
        {
          type: "box", layout: "vertical", margin: "md", spacing: "sm",
          contents: [
            row("B/L No :",           d.bl_no_query),                 // BL_NO_QUERY
            row("Category :",         d.category),                    // CATEGORY
            row("Vessel :",           vessel),                        // IN/OUT_SHIP_NAME
            row("Voyage :",           voyage),                        // IN/OUT_SHIP_VOY
            row("Customer :",         d.customer),                    // CUSTOMER
            row("Total Containers :", String(d.container_count)),     // COUNT(CNTR_NBR)
          ]
        },
        { type: "separator", margin: "md" },
        { type: "text", text: "Note: For more details, visit HPT DIGITAL PLATFORM.", size: "xs", color: "#aaaaaa", wrap: true, margin: "md" }
      ]
    },
    footer: {
      type: "box", layout: "vertical", spacing: "sm", paddingAll: "10px",
      contents: [
        {
          type: "button", style: "primary", color: "#00B900",
          action: { type: "uri", label: "More Details", uri: "https://uatonline.hutchisonports.co.th" }
        },
        {
          type: "button", style: "secondary", color: "#eeeeee",
          action: { type: "postback", label: "Check Another Booking", data: "action=booking" }
        }
      ]
    }
  };
}

/* =====================================================
   LINE REPLY
===================================================== */
async function replyText(replyToken, text) {
  await axios.post(
    "https://api.line.me/v2/bot/message/reply",
    { replyToken, messages: [{ type: "text", text }] },
    { headers: { Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`, "Content-Type": "application/json" } }
  );
}

async function replyFlex(replyToken, altText, flexJson) {
  await axios.post(
    "https://api.line.me/v2/bot/message/reply",
    { replyToken, messages: [{ type: "flex", altText, contents: flexJson }] },
    { headers: { Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`, "Content-Type": "application/json" } }
  );
}

/* =====================================================
   WEBHOOK
===================================================== */
app.post('/webhook', async (req, res) => {
  try {
    const event = req.body.events?.[0];
    if (!event) return res.sendStatus(200);

    log("EVENT RECEIVED", event);
    const sessionId = event.source.userId;

    // --- Postback ---
    if (event.type === 'postback') {
      const params = new URLSearchParams(event.postback.data);
      const action  = params.get("action");
      const hints   = {
        container: "กรุณาพิมพ์หมายเลขตู้ เช่น TCLU8304461",
        booking:   "กรุณาพิมพ์ booking แล้วตามด้วยเลข\nเช่น booking BKK07102025",
        vessel:    "กรุณาพิมพ์ เรือ แล้วตามด้วยชื่อเรือ\nเช่น เรือ Nanhirun"
      };
      await replyText(event.replyToken, hints[action] || "กรุณาพิมพ์ข้อความ");
      return res.sendStatus(200);
    }

    if (event.type !== 'message' || event.message.type !== 'text')
      return res.sendStatus(200);

    const originalText = event.message.text.trim();
    log("USER TEXT", originalText);

    const search = detectSearchType(originalText);
    log("SEARCH TYPE", search);

    // ---- CONTAINER ----
    if (search.type === 'container') {
      const data = await fetchApex(`container/${encodeURIComponent(search.value)}`);
      const item = getFirstItem(data);
      if (!item) {
        await replyText(event.replyToken, `ไม่พบข้อมูลตู้ ${search.value} ในระบบ`);
      } else {
        await replyFlex(event.replyToken, `Container: ${search.value}`, buildContainerFlex(item));
      }
      return res.sendStatus(200);
    }

    // ---- BOOKING ----
    if (search.type === 'booking') {
      const data = await fetchApex(`booking/${encodeURIComponent(search.value)}`);
      const item = getFirstItem(data);
      if (!item) {
        await replyText(event.replyToken, `ไม่พบข้อมูล Booking ${search.value} ในระบบ`);
      } else {
        await replyFlex(event.replyToken, `Booking: ${search.value}`, buildBookingFlex(item));
      }
      return res.sendStatus(200);
    }

    // ---- VESSEL ----
    if (search.type === 'vessel') {
      const data = await fetchApex(`vessel/${encodeURIComponent(search.value)}`);
      const item = getFirstItem(data);
      if (!item) {
        await replyText(event.replyToken, `ไม่พบข้อมูลเรือ "${search.value}" ในระบบ`);
      } else {
        await replyFlex(event.replyToken, `Vessel: ${search.value}`, buildVesselFlex(item));
      }
      return res.sendStatus(200);
    }

    // ---- DIALOGFLOW EN ----
    const cluResult = await detectIntent(
      "project-chatbot-oacy", authFlex,
      originalText, sessionId, "en"
    );
    if (cluResult.intentDetectionConfidence >= 0.6 && cluResult.fulfillmentText && !isFallback(cluResult)) {
      await replyText(event.replyToken, cluResult.fulfillmentText);
      return res.sendStatus(200);
    }

    // ---- DIALOGFLOW FAQ TH ----
    const faqResult = await detectIntent(
      "project-chatbot-faqs-hpqt", authFAQ,
      originalText, sessionId, "th"
    );
    const faqAnswer = faqResult.fulfillmentText || "ไม่พบข้อมูลที่เกี่ยวข้อง";
    await replyText(event.replyToken, faqAnswer);
    return res.sendStatus(200);

  } catch (err) {
    logError(err);
    return res.sendStatus(200);
  }
});

app.listen(process.env.PORT || 3000, () => {
  console.log("🚀 Bot running on port 3000");
});
