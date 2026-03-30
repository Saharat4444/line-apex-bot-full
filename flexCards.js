/* =====================================================
   flexCards.js
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

function hasValue(v) {
  return v && String(v).trim() !== '' && String(v).trim() !== '-';
}

/* ================= CONTAINER ================= */
function buildContainerFlex(d) {
  const isImport   = (d.trans_type || '').toUpperCase() === 'IMPORT';
  const bookingRef = d.book_bl;

  const footerButtons = [
    {
      type: "button", style: "secondary", color: "#E3E8ED",
      action: { type: "postback", label: "ตรวจสอบตู้คอนเทนเนอร์อื่น", data: "action=container" }
    }
  ];

  if (hasValue(bookingRef)) {
    footerButtons.unshift({
      type: "button", style: "primary", color: "#2C5F8A",
      action: {
        type: "postback",
        label: "ตรวจสอบการจอง",
        data: `action=lookup_booking&value=${String(bookingRef).trim()}`
      }
    });
  }

  footerButtons.push({
    type: "button", style: "secondary", color: "#E3E8ED",
    action: {
      type: "postback",
      label: "ประเมินความพอใจ",
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
            row("Sz/Ty/Ht :", d.sz_ty_ht),
            row("Category :", d.trans_type),
            row("Status :", d.status),
            row("Location :", d.loc),
            row("Vessel/Voyage :", d.vessel),
            row("Line :", d.line_id),
            row(isImport ? "Bill of Lading :" : "Booking :", d.book_bl),
            row("Home Berthing :", d.home_berth_tml),
            row("Hold Status :", d.account_status),
            row("PVB :", d.valid_before),
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

/* ================= BOOKING ================= */
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
            row("Vessel :", d.vessel_name),
            row("Voyage :", d.voyage),
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
          type: "button", style: "primary", color: "#2C5F8A",
          action: { type: "uri", label: "ดูรายละเอียดเพิ่มเติม", uri: "https://uatonline.hutchisonports.co.th" }
        },
        {
          type: "button", style: "secondary", color: "#E3E8ED",
          action: { type: "postback", label: "ตรวจสอบการจองอื่น", data: "action=booking" }
        },
        {
          type: "button", style: "secondary", color: "#E3E8ED",
          action: {
            type: "postback",
            label: "ประเมินความพอใจ",
            data: `action=survey&ref=${encodeURIComponent(d.booking_bl || '')}`
          }
        }
      ]
    }
  };
}

/* ================= VESSEL ================= */
// row() เดิมไม่ต้องแตะเลย ปล่อยไว้ให้ card อื่นใช้

function rowVertical(label, value) {
  return {
    type: "box", layout: "horizontal", spacing: "sm",
    contents: [
      {
        type: "text", text: label,
        size: "sm", color: "#888888", wrap: true, flex: 3
      },
      {
        type: "text", text: value || "-",
        size: "sm", weight: "bold", wrap: true, flex: 2,
        align: "end"
      }
    ]
  };
}
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
            rowVertical("Voyage Code :", d.voyage_code),       // ← เปลี่ยนเป็น rowVertical
            rowVertical("Arrives in Terminal :", d.arrives_in_terminal),
            rowVertical("Estimated Arrival :", d.eta),
            rowVertical("Estimate Departure :", d.dep),
            rowVertical("Closing :", d.closing),
            rowVertical("Currently in Port :", d.currently_in_port),
          ]
        }
      ]
    },
    footer: {
      type: "box", layout: "vertical", spacing: "sm", paddingAll: "10px",
      contents: [
        {
          type: "button", style: "secondary", color: "#E3E8ED",
          action: { type: "postback", label: "ตรวจสอบเรือลำอื่น", data: "action=vessel" }
        },
        {
          type: "button", style: "secondary", color: "#E3E8ED",
          action: {
            type: "postback",
            label: "ประเมินความพอใจ",
            data: `action=survey&ref=${encodeURIComponent(d.ship_name || '')}`
          }
        }
      ]
    }
  };
}

/* ================= SURVEY ================= */
function buildSurveyFlex(refId = '') {

  function starBtn(score) {
    return {
      type: "button",
      style: "primary",
      height: "sm",
      flex: 1, // ✅ ทำให้ปุ่มเท่ากัน
      color: score === 5 ? "#2C5F8A"
           : score === 4 ? "#6FA3C7"
           : score === 3 ? "#9FC0DC"
           : score === 2 ? "#C7D9EA"
           :               "#CFD8DC",
      action: {
        type: "postback",
        label: String(score), // ✅ เหลือแค่ตัวเลข
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
        { type: "separator", margin: "lg" },
        { type: "text", text: "1 = น้อยที่สุด   5 = มากที่สุด",
          size: "xs", color: "#aaaaaa", align: "center", margin: "md" },
      ]
    },
    footer: {
      type: "box",
      layout: "horizontal", // ✅ แถวเดียว
      spacing: "sm",
      paddingAll: "10px",
      contents: [
        starBtn(1),
        starBtn(2),
        starBtn(3),
        starBtn(4),
        starBtn(5)
      ]
    }
  };
}

module.exports = {
  buildContainerFlex,
  buildBookingFlex,
  buildVesselFlex,
  buildSurveyFlex
};
