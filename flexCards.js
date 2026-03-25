/* =====================================================
   flexCards.js
   รวม Flex Card ทั้งหมด — แก้ design การ์ดที่นี่
   ถ้าอยากเพิ่มการ์ดใหม่:
     1. เพิ่ม function buildXxxFlex(d) ที่นี่
     2. เพิ่มชื่อใน module.exports ด้านล่าง
     3. import ใน sever.js
===================================================== */

/* =====================================================
   HELPER — row label + value
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

// ตรวจว่าค่ามีอยู่จริง ไม่ใช่ null หรือ '-'
function hasValue(v) {
  return v && String(v).trim() !== '' && String(v).trim() !== '-';
}

/* =====================================================
   CARD — Container detail (IMPORT & EXPORT)
   Column mapping (ชื่อจริงในตาราง NEDR_CNTR_DETAIL_TRUCK_SN):
     CNTR_ID        → header
     SZ_TY_HT       → Sz/Ty/Ht  (size_id||'/'||type_id||'/'||height_id)
     TRANS_TYPE     → Category  (ไม่ใช่ CATEGORY)
     STATUS         → Status
     LOC            → Location  (decode V/Y/T/R)
     VESSEL         → Vessel/Voyage
     LINE_ID        → Line      (ไม่ใช่ LINE)
     BOOK_BL        → CASE WHEN TRANS_TYPE='IMPORT' THEN BL_NO ELSE BOOK_NO
     HOME_BERTH_TML → Home Berthing
     ACCOUNT_STATUS → Hold Status (ไม่ใช่ CUSTOM_RELEASED)
     VALID_BEFORE   → PVB (valid_before - 1/86400)
===================================================== */
function buildContainerFlex(d) {
  const isImport   = (d.trans_type || '').toUpperCase() === 'IMPORT'; // ✅ ใช้ trans_type
  const bookingRef = d.book_bl;

  // ปุ่ม footer — มีปุ่ม default เสมอ
  const footerButtons = [
    {
      type: "button", style: "secondary", color: "#eeeeee",
      action: { type: "postback", label: "Check another container", data: "action=container" }
    }
  ];

  // ปุ่มสีเขียว "Check Booking" — แสดงเฉพาะเมื่อ book_bl มีค่าจริง
  if (hasValue(bookingRef)) {
    footerButtons.unshift({
      type: "button", style: "primary", color: "#00B900",
      action: {
        type: "postback",
        label: "Check Booking",
        data: `action=lookup_booking&value=${String(bookingRef).trim()}`
      }
    });
  }

  // ปุ่มประเมินความพอใจ
  footerButtons.push({
    type: "button", style: "secondary", color: "#eeeeee",
    action: {
      type: "postback",
      label: "⭐ ประเมินความพอใจ",
      data: `action=survey&ref=${encodeURIComponent(d.cntr_id || '')}`
    }
  });

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
            row("Sz/Ty/Ht :",      d.sz_ty_ht),
            row("Category :",      d.trans_type),    // ✅ TRANS_TYPE
            row("Status :",        d.status),
            row("Location :",      d.loc),
            row("Vessel/Voyage :", d.vessel),
            row("Line :",          d.line_id),       // ✅ LINE_ID
            row(isImport ? "Bill of Lading :" : "Booking :", d.book_bl),
            row("Home Berthing :", d.home_berth_tml),
            row("Hold Status :",   d.account_status),// ✅ ACCOUNT_STATUS
            row("PVB :",           d.valid_before),
          ]
        },
        { type: "text", text: "PVB : Payment Valid Before", size: "xs", color: "#aaaaaa", margin: "md" }
      ]
    },
    footer: {
      type: "box", layout: "vertical", spacing: "sm", paddingAll: "10px",
      contents: footerButtons
    }
  };
}

/* =====================================================
   CARD — Booking
   Column mapping:
     BOOKING_BL       → header
     VESSEL_NAME      → Vessel  (REGEXP_SUBSTR ส่วนที่ 1)
     VOYAGE           → Voyage  (REGEXP_SUBSTR ส่วนที่ 2)
     CONTAINER_COUNT  → Total Containers (COUNT GROUP BY)
===================================================== */
function buildBookingFlex(d) {
  return {
    type: "bubble", size: "mega",
    body: {
      type: "box", layout: "vertical", spacing: "md", paddingAll: "20px",
      contents: [
        { type: "text", text: "Booking", weight: "bold", size: "sm", color: "#333333" },
        { type: "text", text: d.booking_bl || "-", weight: "bold", size: "xxl", wrap: true },
        { type: "separator", margin: "md" },
        {
          type: "box", layout: "vertical", margin: "md", spacing: "sm",
          contents: [
            row("Vessel :",           d.vessel_name),
            row("Voyage :",           d.voyage),
            row("Total Containers :", String(d.container_count || "-")),
          ]
        },
        { type: "separator", margin: "md" },
        { type: "text", text: "Note: For more details, visit HPT DIGITAL PLATFORM.",
          size: "xs", color: "#aaaaaa", wrap: true, margin: "md" }
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
        },
        // ✅ ปุ่มประเมินความพอใจ — ส่ง booking_bl เป็น refId
        {
          type: "button", style: "secondary", color: "#eeeeee",
          action: {
            type: "postback",
            label: "⭐ ประเมินความพอใจ",
            data: `action=survey&ref=${encodeURIComponent(d.booking_bl || '')}`
          }
        }
      ]
    }
  };
}

/* =====================================================
   CARD — Vessel Schedule
   Column mapping:
     SHIP_NAME           → header
     VOYAGE_CODE         → Voyage Code  (SHIPS_ID)
     ARRIVES_IN_TERMINAL → Arrives in Terminal (ARR)
     ETA                 → Estimated Arrival
     DEP                 → Estimate Departure
     CLOSING             → Closing (CARGO_CUTOFF)
     CURRENTLY_IN_PORT   → Currently in Port (BERTH)
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
            row("Voyage Code :",         d.voyage_code),
            row("Arrives in Terminal :", d.arrives_in_terminal),
            row("Estimated Arrival :",   d.eta),
            row("Estimate Departure :",  d.dep),
            row("Closing :",             d.closing),
            row("Currently in Port :",   d.currently_in_port),
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
   CARD — Satisfaction Survey (กดดาว 1-5)
   refId = หมายเลขตู้ / booking ที่อ้างอิง
===================================================== */
function buildSurveyFlex(refId = '') {
  const refLabel = refId ? `\nอ้างอิง: ${refId}` : '';

  function starBtn(score, label) {
    return {
      type: "button",
      style: score >= 4 ? "primary" : "secondary",
      color: score === 5 ? "#FF9500"
           : score === 4 ? "#FFCC00"
           : score === 3 ? "#8BC34A"
           : score === 2 ? "#78909C"
           :               "#B0BEC5",
      action: {
        type: "postback",
        label,
        data: `action=rate&score=${score}&ref=${encodeURIComponent(refId)}`
      }
    };
  }

  return {
    type: "bubble", size: "mega",
    body: {
      type: "box", layout: "vertical", spacing: "md", paddingAll: "20px",
      contents: [
        { type: "text", text: "ประเมินความพอใจ", weight: "bold", size: "lg",
          color: "#333333", align: "center" },
        { type: "text", text: "กรุณาให้คะแนนการบริการ",
          size: "sm", color: "#aaaaaa", align: "center", wrap: true, margin: "sm" },
        // แสดง refId เฉพาะเมื่อมีค่า
        ...(refId ? [{
          type: "box", layout: "horizontal", margin: "sm",
          contents: [
            { type: "text", text: "อ้างอิง:", size: "xs", color: "#aaaaaa", flex: 3 },
            { type: "text", text: refId, size: "xs", weight: "bold", color: "#333333", flex: 7, wrap: true }
          ]
        }] : []),
        { type: "separator", margin: "lg" },
        { type: "text", text: "1 = น้อยที่สุด   5 = มากที่สุด",
          size: "xs", color: "#aaaaaa", align: "center", margin: "md" },
      ]
    },
    footer: {
      type: "box", layout: "vertical", spacing: "sm", paddingAll: "10px",
      contents: [
        {
          type: "box", layout: "horizontal", spacing: "sm",
          contents: [
            starBtn(1, "⭐ 1"),
            starBtn(2, "⭐ 2"),
            starBtn(3, "⭐ 3"),
          ]
        },
        {
          type: "box", layout: "horizontal", spacing: "sm",
          contents: [
            starBtn(4, "⭐⭐ 4"),
            starBtn(5, "⭐⭐⭐ 5"),
          ]
        }
      ]
    }
  };
}

/* =====================================================
   EXPORTS
   ถ้าเพิ่มการ์ดใหม่ → เพิ่มชื่อ function ที่นี่ด้วย
===================================================== */
module.exports = {
  buildContainerFlex,
  buildBookingFlex,
  buildVesselFlex,
  buildSurveyFlex
};
