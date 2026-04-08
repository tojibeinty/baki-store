// ============================================
// باكي ستور — بوت إداري على Vercel
// الملف: api/bot.js
// ============================================

const FIREBASE_PROJECT = 'baki-store-9bc21';
const FIREBASE_API_KEY = 'AIzaSyDNyLcBRcVOQ5jxWlML1Jk0GNaOfybPqLM';
const FS_BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents`;

// ============ بيانات مشفّرة ============
const _K = '62616b692d73746f72652d7365637265';
const _T = 'AQsDAAJXDwsEVg1ydnNZV2J9cQB5UWhHAFpYXkMEA0xVRmQHfStPcHNWRFYCDA==';
const _C = 'AAAAAgdbAw4CVQ==';

function _dec(enc, k) {
  const b = Buffer.from(enc, 'base64');
  const kb = Buffer.from(k, 'hex').toString('ascii');
  return b.map((byte, i) => byte ^ kb.charCodeAt(i % kb.length)).toString('ascii');
}

const BOT_TOKEN     = _dec(_T, _K);
const ADMIN_CHAT_ID = _dec(_C, _K);

// ============ Cloudinary ============
const CLOUDINARY_CLOUD      = 'dx2drikbu';
const CLOUDINARY_API_KEY    = '928216213266583';
const CLOUDINARY_API_SECRET = 'xuJxppmIZ920Xs8HSIuYgLGeEWI';

async function uploadToCloudinary(imageBuffer, filename) {
  const crypto = await import('crypto');
  const timestamp = Math.floor(Date.now() / 1000);
  const folder = 'baki-store';
  const paramStr = `folder=${folder}&timestamp=${timestamp}`;
  const signature = crypto.createHash('sha1')
    .update(paramStr + CLOUDINARY_API_SECRET)
    .digest('hex');

  const formData = new FormData();
  formData.append('file', new Blob([imageBuffer]), filename || 'product.jpg');
  formData.append('api_key', CLOUDINARY_API_KEY);
  formData.append('timestamp', String(timestamp));
  formData.append('folder', folder);
  formData.append('signature', signature);

  const res = await fetch(`https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD}/image/upload`, {
    method: 'POST',
    body: formData
  });
  const data = await res.json();
  if (!data.secure_url) throw new Error(data.error?.message || 'Cloudinary upload failed');
  return data.secure_url;
}

// ============ مساعدات Firebase ============
async function fsGet(collection, docId) {
  const url = docId
    ? `${FS_BASE}/${collection}/${docId}?key=${FIREBASE_API_KEY}`
    : `${FS_BASE}/${collection}?key=${FIREBASE_API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  return res.json();
}

async function fsPatch(collection, docId, fields) {
  const fieldPaths = Object.keys(fields).map(k => `updateMask.fieldPaths=${k}`).join('&');
  const res = await fetch(`${FS_BASE}/${collection}/${docId}?key=${FIREBASE_API_KEY}&${fieldPaths}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields })
  });
  return res.json();
}

async function fsPost(collection, fields) {
  const res = await fetch(`${FS_BASE}/${collection}?key=${FIREBASE_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields })
  });
  return res.json();
}

async function fsDelete(collection, docId) {
  await fetch(`${FS_BASE}/${collection}/${docId}?key=${FIREBASE_API_KEY}`, { method: 'DELETE' });
}

// ============ حالة المحادثة عبر Firebase ============
const SESSIONS_COLLECTION = 'bot_sessions';

async function getSession(chatId) {
  try {
    const doc = await fsGet(SESSIONS_COLLECTION, String(chatId));
    if (!doc || !doc.fields) return {};
    const s = {};
    for (const [k, v] of Object.entries(doc.fields)) {
      s[k] = v.stringValue ?? v.integerValue ?? v.booleanValue ?? null;
    }
    return s;
  } catch { return {}; }
}

async function setSession(chatId, data) {
  try {
    const fields = {};
    for (const [k, v] of Object.entries(data)) {
      if (typeof v === 'number') fields[k] = { integerValue: v };
      else if (typeof v === 'boolean') fields[k] = { booleanValue: v };
      else fields[k] = { stringValue: String(v ?? '') };
    }
    await fsPatch(SESSIONS_COLLECTION, String(chatId), fields);
  } catch {
    try {
      const fields = {};
      for (const [k, v] of Object.entries(data)) {
        if (typeof v === 'number') fields[k] = { integerValue: v };
        else if (typeof v === 'boolean') fields[k] = { booleanValue: v };
        else fields[k] = { stringValue: String(v ?? '') };
      }
      await fetch(`${FS_BASE}/${SESSIONS_COLLECTION}?documentId=${chatId}&key=${FIREBASE_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields })
      });
    } catch {}
  }
}

async function clearSession(chatId) {
  try { await fsDelete(SESSIONS_COLLECTION, String(chatId)); } catch {}
}

// ============ إرسال رسائل تيليغرام ============
async function sendMessage(chatId, text, keyboard = null) {
  const body = { chat_id: chatId, text, parse_mode: 'Markdown' };
  if (keyboard) body.reply_markup = keyboard;
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

// ============ مساعد رفع صورة من تيليغرام ============
async function uploadPhotoFromTelegram(photo) {
  const fileId = photo[photo.length - 1].file_id;
  const fileRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${fileId}`);
  const fileData = await fileRes.json();
  const filePath = fileData.result?.file_path;
  const tgImageRes = await fetch(`https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`);
  const imageBuffer = await tgImageRes.arrayBuffer();
  return uploadToCloudinary(imageBuffer, filePath.split('/').pop());
}

// ============================================================
// القوائم
// ============================================================
const MAIN_MENU = {
  inline_keyboard: [
    [{ text: '➕ إضافة منتج',    callback_data: 'add_product'  },
     { text: '📦 عرض المنتجات',  callback_data: 'list_products'}],
    [{ text: '🗑 حذف منتج',      callback_data: 'delete_product'}],
    [{ text: '🎨 إضافة تيشيرت طبعة', callback_data: 'add_print_tshirt' }],
    [{ text: '🖼 إضافة طبعة للمكتبة', callback_data: 'add_print_design' }],
    [{ text: '📋 عرض تيشيرتات الطبعة', callback_data: 'list_print_tshirts'}],
    [{ text: '🗑 حذف تيشيرت طبعة', callback_data: 'delete_print_tshirt'}],
    [{ text: '🎟 إضافة كوبون',   callback_data: 'add_coupon'   },
     { text: '🎟 الكوبونات',     callback_data: 'list_coupons' }],
    [{ text: '📊 إحصائيات',      callback_data: 'stats'        }],
  ]
};

const CAT_KEYBOARD = {
  inline_keyboard: [
    [{ text: '👕 رجالي',      callback_data: 'cat_men'        }],
    [{ text: '👗 نسائي',      callback_data: 'cat_women'      }],
    [{ text: '🎒 اكسسوارات', callback_data: 'cat_accessories' }],
  ]
};

const SIZES_KEYBOARD = {
  inline_keyboard: [
    [{ text:'XS', callback_data:'size_XS' }, { text:'S', callback_data:'size_S' },
     { text:'M',  callback_data:'size_M'  }],
    [{ text:'L',  callback_data:'size_L'  }, { text:'XL', callback_data:'size_XL'},
     { text:'XXL',callback_data:'size_XXL'}],
    [{ text:'✅ تم اختيار الأحجام', callback_data:'sizes_done' }],
  ]
};

const PT_SIZES_KEYBOARD = {
  inline_keyboard: [
    [{ text:'XS', callback_data:'pt_size_XS' }, { text:'S', callback_data:'pt_size_S' },
     { text:'M',  callback_data:'pt_size_M'  }],
    [{ text:'L',  callback_data:'pt_size_L'  }, { text:'XL', callback_data:'pt_size_XL'},
     { text:'XXL',callback_data:'pt_size_XXL'}],
    [{ text:'✅ تم', callback_data:'pt_sizes_done' }],
  ]
};

const BADGE_KEYBOARD = {
  inline_keyboard: [
    [{ text:'🔥 NEW', callback_data:'badge_NEW' },
     { text:'⭐ SALE', callback_data:'badge_SALE'}],
    [{ text:'💎 HOT', callback_data:'badge_HOT' },
     { text:'بدون باج', callback_data:'badge_none'}],
  ]
};

const FABRIC_KEYBOARD = {
  inline_keyboard: [
    [{ text:'قطني 100%',    callback_data:'pt_fabric_قطني 100%'   }],
    [{ text:'قماش أديداس', callback_data:'pt_fabric_قماش أديداس' }],
    [{ text:'قماش نايك',   callback_data:'pt_fabric_قماش نايك'   }],
    [{ text:'بوليستر',      callback_data:'pt_fabric_بوليستر'     }],
    [{ text:'قطني بوليستر',callback_data:'pt_fabric_قطني بوليستر'}],
    [{ text:'اوفر سايز',   callback_data:'pt_fabric_اوفر سايز'   }],
  ]
};

const PT_COLORS_KEYBOARD = {
  inline_keyboard: [
    [{ text:'⚫ أسود',      callback_data:'pt_color_أسود'      }],
    [{ text:'🔴 أحمر',      callback_data:'pt_color_أحمر'      }],
    [{ text:'🔵 أزرق داكن', callback_data:'pt_color_أزرق داكن' }],
    [{ text:'✅ تم اختيار الألوان', callback_data:'pt_colors_done' }],
  ]
};

// ============================================================
// منطق المنتجات العادية
// ============================================================
async function listProducts() {
  try {
    const data = await fsGet('products');
    if (!data?.documents?.length) return '📦 لا توجد منتجات حالياً.';
    const catLabels = { men:'رجالي', women:'نسائي', accessories:'اكسسوارات' };
    return data.documents.map((d, i) => {
      const f = d.fields || {};
      const name  = f.name?.stringValue || 'بدون اسم';
      const price = f.price?.integerValue || f.price?.doubleValue || 0;
      const cat   = catLabels[f.cat?.stringValue] || f.cat?.stringValue || '';
      const docId = d.name.split('/').pop();
      return `${i+1}. *${name}* — ${Number(price).toLocaleString()} د.ع — ${cat}\n   ID: \`${docId}\``;
    }).join('\n\n');
  } catch { return '❌ خطأ في تحميل المنتجات'; }
}

async function deleteProductById(docId) {
  try { await fsDelete('products', docId); return true; }
  catch { return false; }
}

async function saveProduct(product) {
  await fsPost('products', {
    id:       { integerValue: Date.now() },
    name:     { stringValue: product.name },
    cat:      { stringValue: product.cat },
    price:    { integerValue: parseInt(product.price) },
    oldPrice: product.oldPrice ? { integerValue: parseInt(product.oldPrice) } : { nullValue: null },
    desc:     { stringValue: product.desc || '' },
    badge:    { stringValue: product.badge || '' },
    fabric:   { stringValue: '' },
    printColors: { arrayValue: { values: [] } },
    sizes:    { arrayValue: { values: (product.sizes||[]).map(s=>({ stringValue: s })) } },
    images:   { arrayValue: { values: [{ stringValue: product.image || '' }] } }
  });
}

// ============================================================
// منطق تيشيرتات الطبعة (printProducts)
// ============================================================
async function listPrintTshirts() {
  try {
    const data = await fsGet('printProducts');
    if (!data?.documents?.length) return '🎨 لا توجد تيشيرتات طبعة حالياً.';
    return data.documents.map((d, i) => {
      const f = d.fields || {};
      const name    = f.name?.stringValue || 'بدون اسم';
      const price   = f.price?.integerValue || f.price?.doubleValue || 0;
      const fabric  = f.fabric?.stringValue || '—';
      const colors  = f.printColors?.arrayValue?.values?.map(v=>v.stringValue).join(', ') || '—';
      const docId   = d.name.split('/').pop();
      return `${i+1}. *${name}*\n   قماش: ${fabric} | ألوان: ${colors}\n   سعر: ${Number(price).toLocaleString()} د.ع\n   ID: \`${docId}\``;
    }).join('\n\n');
  } catch { return '❌ خطأ في تحميل تيشيرتات الطبعة'; }
}

async function savePrintTshirt(p) {
  await fsPost('printProducts', {
    id:          { integerValue: Date.now() },
    name:        { stringValue: p.name },
    fabric:      { stringValue: p.fabric || '' },
    printColors: { arrayValue: { values: (p.printColors||[]).map(c=>({ stringValue: c })) } },
    price:       { integerValue: parseInt(p.price) },
    oldPrice:    p.oldPrice ? { integerValue: parseInt(p.oldPrice) } : { nullValue: null },
    desc:        { stringValue: p.desc || '' },
    sizes:       { arrayValue: { values: (p.sizes||[]).map(s=>({ stringValue: s })) } },
    images:      { arrayValue: { values: (p.images||[]).map(url=>({ stringValue: url })) } }
  });
}

async function deletePrintTshirtById(docId) {
  try { await fsDelete('printProducts', docId); return true; }
  catch { return false; }
}

// ============================================================
// منطق طبعات المكتبة (printDesigns)
// ============================================================
async function savePrintDesign(name, url) {
  await fsPost('printDesigns', {
    name: { stringValue: name },
    url:  { stringValue: url }
  });
}

// ============================================================
// الكوبونات
// ============================================================
async function listCoupons() {
  try {
    const data = await fsGet('coupons');
    if (!data?.documents?.length) return '🎟 لا توجد كوبونات حالياً.';
    return data.documents.map((d, i) => {
      const f       = d.fields || {};
      const code    = f.code?.stringValue || '';
      const discount= f.discount?.integerValue || f.discount?.doubleValue || 0;
      const usesLeft= f.usesLeft?.integerValue || f.usesLeft?.doubleValue || 0;
      const docId   = d.name.split('/').pop();
      return `${i+1}. *${code}* — خصم ${discount}% — متبقي ${usesLeft}\n   ID: \`${docId}\``;
    }).join('\n\n');
  } catch { return '❌ خطأ في تحميل الكوبونات'; }
}

async function getStats() {
  try {
    const [prods, printProds, coupons, analytics] = await Promise.all([
      fsGet('products'), fsGet('printProducts'), fsGet('coupons'), fsGet('analytics')
    ]);
    const prodCount  = prods?.documents?.length || 0;
    const printCount = printProds?.documents?.length || 0;
    const couponCount= coupons?.documents?.length || 0;
    const today = new Date().toLocaleDateString('ar-IQ').replace(/\//g, '-');
    let todayVisits = 0;
    if (analytics?.documents) {
      const d = analytics.documents.find(d => d.name.includes(`visits-${today}`));
      if (d) todayVisits = parseInt(d.fields?.visits?.integerValue || 0);
    }
    return `📊 *إحصائيات باكي ستور*\n\n📦 المنتجات: ${prodCount}\n🎨 تيشيرتات الطبعة: ${printCount}\n🎟 الكوبونات: ${couponCount}\n👁 زيارات اليوم: ${todayVisits}`;
  } catch { return '❌ خطأ في تحميل الإحصائيات'; }
}

// ============================================================
// معالج الرسائل
// ============================================================
async function handleMessage(msg) {
  const chatId = String(msg.chat?.id);
  const text   = msg.text || '';
  const photo  = msg.photo;

  if (chatId !== ADMIN_CHAT_ID) {
    await sendMessage(chatId, '🚫 غير مصرح لك باستخدام هذا البوت.');
    return;
  }

  const session = await getSession(chatId);
  const step    = session.step || '';

  // ── أوامر رئيسية ──────────────────────────────────────
  if (text === '/start' || text === '/menu') {
    await clearSession(chatId);
    await sendMessage(chatId, '👋 أهلاً بك في لوحة تحكم *باكي ستور* 🛒\n\nشنو تريد تسوي؟', MAIN_MENU);
    return;
  }
  if (text === '/cancel') {
    await clearSession(chatId);
    await sendMessage(chatId, '❌ تم الإلغاء.', MAIN_MENU);
    return;
  }

  // ══════════════════════════════════════════════════════
  // خطوات إضافة منتج عادي
  // ══════════════════════════════════════════════════════
  if (step === 'await_name') {
    await setSession(chatId, { ...session, step: 'await_price', name: text });
    await sendMessage(chatId, '💰 أدخل *السعر* (بالدينار العراقي، أرقام فقط):');
    return;
  }
  if (step === 'await_price') {
    if (isNaN(text.trim())) { await sendMessage(chatId, '❌ أدخل رقماً صحيحاً:'); return; }
    await setSession(chatId, { ...session, step: 'await_old_price', price: text.trim() });
    await sendMessage(chatId, '🏷 أدخل *السعر القديم* (اختياري — أرسل 0 إذا ما في خصم):');
    return;
  }
  if (step === 'await_old_price') {
    const op = text.trim() === '0' ? '' : text.trim();
    await setSession(chatId, { ...session, step: 'await_desc', oldPrice: op });
    await sendMessage(chatId, '📝 أدخل *وصف* المنتج (اختياري — أرسل - للتخطي):');
    return;
  }
  if (step === 'await_desc') {
    const desc = text.trim() === '-' ? '' : text.trim();
    await setSession(chatId, { ...session, step: 'await_cat', desc });
    await sendMessage(chatId, '📂 اختر *القسم*:', CAT_KEYBOARD);
    return;
  }
  if (step === 'await_image_url') {
    if (!text.trim().startsWith('http')) { await sendMessage(chatId, '❌ أرسل رابط صحيح يبدأ بـ https://'); return; }
    await setSession(chatId, { ...session, step: 'await_badge', image: text.trim() });
    await sendMessage(chatId, '🏅 اختر *الباج*:', BADGE_KEYBOARD);
    return;
  }
  if (step === 'await_image_file') {
    if (photo?.length > 0) {
      await sendMessage(chatId, '⏳ جاري رفع الصورة على Cloudinary...');
      try {
        const cloudUrl = await uploadPhotoFromTelegram(photo);
        await setSession(chatId, { ...session, step: 'await_badge', image: cloudUrl });
        await sendMessage(chatId, '✅ تم رفع الصورة!\n\n🏅 اختر *الباج*:', BADGE_KEYBOARD);
      } catch (e) {
        await sendMessage(chatId, '❌ فشل رفع الصورة.');
        console.error(e);
      }
    } else if (text?.startsWith('http')) {
      await sendMessage(chatId, '⏳ جاري رفع الصورة...');
      try {
        const imgRes = await fetch(text.trim());
        const buf = await imgRes.arrayBuffer();
        const cloudUrl = await uploadToCloudinary(buf, 'product.jpg');
        await setSession(chatId, { ...session, step: 'await_badge', image: cloudUrl });
        await sendMessage(chatId, '✅ تم رفع الصورة!\n\n🏅 اختر *الباج*:', BADGE_KEYBOARD);
      } catch { await sendMessage(chatId, '❌ فشل رفع الصورة، تأكد من الرابط.'); }
    } else {
      await sendMessage(chatId, '📸 أرسل *صورة* مباشرةً أو *رابط* يبدأ بـ https://');
    }
    return;
  }
  if (step === 'await_delete_id') {
    const ok = await deleteProductById(text.trim());
    await clearSession(chatId);
    if (ok) await sendMessage(chatId, '✅ تم حذف المنتج!', MAIN_MENU);
    else    await sendMessage(chatId, '❌ ما قدرت أحذف المنتج. تأكد من الـ ID.', MAIN_MENU);
    return;
  }

  // خطوات الكوبون
  if (step === 'await_coupon_code') {
    await setSession(chatId, { ...session, step: 'await_coupon_discount', couponCode: text.trim().toUpperCase() });
    await sendMessage(chatId, '💸 أدخل *نسبة الخصم* (1-100):');
    return;
  }
  if (step === 'await_coupon_discount') {
    const d = parseInt(text.trim());
    if (isNaN(d)||d<1||d>100) { await sendMessage(chatId, '❌ أدخل رقماً من 1 إلى 100:'); return; }
    await setSession(chatId, { ...session, step: 'await_coupon_uses', couponDiscount: d });
    await sendMessage(chatId, '🔢 أدخل *عدد مرات الاستخدام*:');
    return;
  }
  if (step === 'await_coupon_uses') {
    const uses = parseInt(text.trim());
    if (isNaN(uses)||uses<1) { await sendMessage(chatId, '❌ أدخل رقماً صحيحاً:'); return; }
    try {
      await fsPost('coupons', {
        code:     { stringValue: session.couponCode },
        discount: { integerValue: parseInt(session.couponDiscount) },
        usesLeft: { integerValue: uses }
      });
      await clearSession(chatId);
      await sendMessage(chatId, `✅ تم إضافة كوبون *${session.couponCode}*!\nخصم: ${session.couponDiscount}%\nاستخدامات: ${uses}`, MAIN_MENU);
    } catch { await sendMessage(chatId, '❌ خطأ في الحفظ.', MAIN_MENU); }
    return;
  }

  // ══════════════════════════════════════════════════════
  // خطوات إضافة تيشيرت طبعة
  // ══════════════════════════════════════════════════════
  if (step === 'pt_await_name') {
    await setSession(chatId, { ...session, step: 'pt_await_price', pt_name: text.trim() });
    await sendMessage(chatId, '💰 أدخل *السعر* (دينار عراقي):');
    return;
  }
  if (step === 'pt_await_price') {
    if (isNaN(text.trim())) { await sendMessage(chatId, '❌ أدخل رقماً صحيحاً:'); return; }
    await setSession(chatId, { ...session, step: 'pt_await_old_price', pt_price: text.trim() });
    await sendMessage(chatId, '🏷 السعر القديم (اختياري — أرسل 0 للتخطي):');
    return;
  }
  if (step === 'pt_await_old_price') {
    const op = text.trim() === '0' ? '' : text.trim();
    await setSession(chatId, { ...session, step: 'pt_await_desc', pt_oldPrice: op });
    await sendMessage(chatId, '📝 وصف التيشيرت (اختياري — أرسل - للتخطي):');
    return;
  }
  if (step === 'pt_await_desc') {
    const desc = text.trim() === '-' ? '' : text.trim();
    await setSession(chatId, { ...session, step: 'pt_await_fabric', pt_desc: desc });
    await sendMessage(chatId, '🧵 اختر *نوع القماش*:', FABRIC_KEYBOARD);
    return;
  }
  if (step === 'pt_await_sizes') {
    // الأحجام تُختار بالأزرار — هذا الـ step ينتظر ضغطة زر
    await sendMessage(chatId, '👟 اختر *الأحجام* ثم اضغط "تم":', PT_SIZES_KEYBOARD);
    return;
  }
  if (step === 'pt_await_colors') {
    // الألوان تُختار بالأزرار — هذا الـ step ينتظر ضغطة زر
    await sendMessage(chatId, '🎨 اختر *ألوان الطبعة* ثم اضغط "تم":', PT_COLORS_KEYBOARD);
    return;
  }
  if (step === 'pt_await_image') {
    if (photo?.length > 0) {
      await sendMessage(chatId, '⏳ جاري رفع الصورة على Cloudinary...');
      try {
        const cloudUrl = await uploadPhotoFromTelegram(photo);
        // check if there are more images or done
        const imgs = session.pt_images ? session.pt_images.split('||').filter(Boolean) : [];
        imgs.push(cloudUrl);
        await setSession(chatId, { ...session, pt_images: imgs.join('||') });
        await sendMessage(chatId,
          `✅ تم رفع الصورة ${imgs.length}!\n\nأرسل *صورة إضافية* (للوجه الخلفي مثلاً) أو اضغط "تم" إذا انتهيت:`,
          {
            inline_keyboard: [[
              { text: `✅ تم — حفظ التيشيرت (${imgs.length} صورة)`, callback_data: 'pt_images_done' }
            ]]
          }
        );
      } catch (e) {
        await sendMessage(chatId, '❌ فشل رفع الصورة، حاول مرة ثانية.');
        console.error(e);
      }
    } else if (text?.startsWith('http')) {
      await sendMessage(chatId, '⏳ جاري رفع الصورة...');
      try {
        const imgRes = await fetch(text.trim());
        const buf = await imgRes.arrayBuffer();
        const cloudUrl = await uploadToCloudinary(buf, 'tshirt.jpg');
        const imgs = session.pt_images ? session.pt_images.split('||').filter(Boolean) : [];
        imgs.push(cloudUrl);
        await setSession(chatId, { ...session, pt_images: imgs.join('||') });
        await sendMessage(chatId,
          `✅ تم رفع الصورة ${imgs.length}!\n\nأرسل *صورة إضافية* أو اضغط "تم":`,
          {
            inline_keyboard: [[
              { text: `✅ تم — حفظ (${imgs.length} صورة)`, callback_data: 'pt_images_done' }
            ]]
          }
        );
      } catch { await sendMessage(chatId, '❌ فشل رفع الصورة.'); }
    } else {
      await sendMessage(chatId, '📸 أرسل *صورة* مباشرةً أو *رابط* يبدأ بـ https://');
    }
    return;
  }

  // ══════════════════════════════════════════════════════
  // خطوات إضافة طبعة للمكتبة
  // ══════════════════════════════════════════════════════
  if (step === 'pd_await_name') {
    await setSession(chatId, { ...session, step: 'pd_await_image', pd_name: text.trim() });
    await sendMessage(chatId, '🖼 أرسل *صورة الطبعة* (PNG مفضلاً) أو رابط مباشر:');
    return;
  }
  if (step === 'pd_await_image') {
    if (photo?.length > 0) {
      await sendMessage(chatId, '⏳ جاري رفع الطبعة على Cloudinary...');
      try {
        const cloudUrl = await uploadPhotoFromTelegram(photo);
        await savePrintDesign(session.pd_name || 'طبعة', cloudUrl);
        await clearSession(chatId);
        await sendMessage(chatId, `✅ تمت إضافة الطبعة *"${session.pd_name}"* للمكتبة!\nالرابط: ${cloudUrl}`, MAIN_MENU);
      } catch (e) {
        await sendMessage(chatId, '❌ فشل رفع الطبعة.');
        console.error(e);
      }
    } else if (text?.startsWith('http')) {
      try {
        await savePrintDesign(session.pd_name || 'طبعة', text.trim());
        await clearSession(chatId);
        await sendMessage(chatId, `✅ تمت إضافة الطبعة *"${session.pd_name}"* بالرابط!`, MAIN_MENU);
      } catch { await sendMessage(chatId, '❌ خطأ في الحفظ.', MAIN_MENU); }
    } else {
      await sendMessage(chatId, '📸 أرسل *صورة* مباشرةً أو *رابط* يبدأ بـ https://');
    }
    return;
  }

  // ── حذف تيشيرت طبعة ──
  if (step === 'pt_await_delete_id') {
    const ok = await deletePrintTshirtById(text.trim());
    await clearSession(chatId);
    if (ok) await sendMessage(chatId, '✅ تم حذف تيشيرت الطبعة!', MAIN_MENU);
    else    await sendMessage(chatId, '❌ ما قدرت أحذف. تأكد من الـ ID.', MAIN_MENU);
    return;
  }

  // fallback
  await sendMessage(chatId, '👇 استخدم /start للقائمة الرئيسية', MAIN_MENU);
}

// ============================================================
// معالج الـ Callbacks (الأزرار)
// ============================================================
async function handleCallback(cb) {
  const chatId = String(cb.message?.chat?.id);
  const data   = cb.data;

  if (chatId !== ADMIN_CHAT_ID) return;

  const session = await getSession(chatId);

  // أجب فوراً على الـ callback
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: cb.id })
  });

  // ── القائمة الرئيسية ────────────────────────────────
  if (data === 'add_product') {
    await setSession(chatId, { step: 'await_name' });
    await sendMessage(chatId, '📦 *إضافة منتج جديد*\n\nأدخل *اسم* المنتج:\n\n_(أرسل /cancel للإلغاء)_');
    return;
  }
  if (data === 'list_products') {
    const list = await listProducts();
    await sendMessage(chatId, `📦 *المنتجات الحالية:*\n\n${list}`, MAIN_MENU);
    return;
  }
  if (data === 'delete_product') {
    const list = await listProducts();
    await setSession(chatId, { step: 'await_delete_id' });
    await sendMessage(chatId, `🗑 *حذف منتج*\n\n${list}\n\nأرسل *ID* المنتج:`);
    return;
  }
  if (data === 'add_coupon') {
    await setSession(chatId, { step: 'await_coupon_code' });
    await sendMessage(chatId, '🎟 *إضافة كوبون*\n\nأدخل *كود* الكوبون (مثال: BAKI20):');
    return;
  }
  if (data === 'list_coupons') {
    await sendMessage(chatId, `🎟 *الكوبونات:*\n\n${await listCoupons()}`, MAIN_MENU);
    return;
  }
  if (data === 'stats') {
    await sendMessage(chatId, await getStats(), MAIN_MENU);
    return;
  }

  // ── قسم تيشيرتات الطبعة ─────────────────────────────
  if (data === 'add_print_tshirt') {
    await setSession(chatId, { step: 'pt_await_name', pt_sizes: '', pt_colors: '', pt_images: '' });
    await sendMessage(chatId,
      '🎨 *إضافة تيشيرت طبعة جديد*\n\nأدخل *اسم* التيشيرت:\n\n_(أرسل /cancel للإلغاء)_'
    );
    return;
  }
  if (data === 'list_print_tshirts') {
    await sendMessage(chatId, `🎨 *تيشيرتات الطبعة:*\n\n${await listPrintTshirts()}`, MAIN_MENU);
    return;
  }
  if (data === 'delete_print_tshirt') {
    const list = await listPrintTshirts();
    await setSession(chatId, { step: 'pt_await_delete_id' });
    await sendMessage(chatId, `🗑 *حذف تيشيرت طبعة*\n\n${list}\n\nأرسل *ID* التيشيرت:`);
    return;
  }

  // ── طبعات المكتبة ────────────────────────────────────
  if (data === 'add_print_design') {
    await setSession(chatId, { step: 'pd_await_name' });
    await sendMessage(chatId,
      '🖼 *إضافة طبعة للمكتبة*\n\nأدخل *اسم* الطبعة (مثال: شعار نار):\n\n_(أرسل /cancel للإلغاء)_'
    );
    return;
  }

  // ── قسم المنتجات: القسم، الأحجام، الباج ─────────────
  if (data.startsWith('cat_')) {
    const cat = data.replace('cat_', '');
    await setSession(chatId, { ...session, step: 'await_sizes', cat, sizes: '' });
    await sendMessage(chatId, '👟 اختر *الأحجام* (اضغط واحد واحد ثم "تم"):', SIZES_KEYBOARD);
    return;
  }
  if (data.startsWith('size_')) {
    const size = data.replace('size_', '');
    const cur  = session.sizes ? session.sizes.split(',').filter(Boolean) : [];
    const upd  = cur.includes(size) ? cur.filter(s=>s!==size) : [...cur, size];
    await setSession(chatId, { ...session, sizes: upd.join(',') });
    await sendMessage(chatId,
      cur.includes(size)
        ? `❌ إزالة *${size}* | المختار: ${upd.join(', ')||'—'}`
        : `✅ إضافة *${size}* | المختار: ${upd.join(', ')}`,
      SIZES_KEYBOARD
    );
    return;
  }
  if (data === 'sizes_done') {
    const sizes = session.sizes ? session.sizes.split(',').filter(Boolean) : [];
    if (!sizes.length) { await sendMessage(chatId, '❌ اختر حجماً واحداً على الأقل!', SIZES_KEYBOARD); return; }
    await setSession(chatId, { ...session, step: 'await_image_file' });
    await sendMessage(chatId, `✅ الأحجام: *${sizes.join(', ')}*\n\n📸 أرسل *صورة* المنتج مباشرةً أو أرسل رابط:`);
    return;
  }
  if (data.startsWith('badge_')) {
    const badge = data === 'badge_none' ? '' : data.replace('badge_', '');
    const sizes = session.sizes ? session.sizes.split(',').filter(Boolean) : [];
    try {
      await saveProduct({
        name: session.name, cat: session.cat, price: session.price,
        oldPrice: session.oldPrice||null, desc: session.desc||'', badge, sizes,
        image: session.image||''
      });
      await clearSession(chatId);
      await sendMessage(chatId,
        `✅ *تم إضافة المنتج!*\n\n📦 ${session.name}\n💰 ${Number(session.price).toLocaleString()} د.ع\n📂 ${session.cat}\n👟 ${sizes.join(', ')}\n🏅 ${badge||'بدون'}`,
        MAIN_MENU
      );
    } catch { await sendMessage(chatId, '❌ خطأ في حفظ المنتج.', MAIN_MENU); }
    return;
  }

  // ── تيشيرت الطبعة: نوع القماش ───────────────────────
  if (data.startsWith('pt_fabric_')) {
    const fabric = data.replace('pt_fabric_', '');
    await setSession(chatId, { ...session, step: 'pt_await_sizes', pt_fabric: fabric, pt_sizes: '' });
    await sendMessage(chatId,
      `✅ نوع القماش: *${fabric}*\n\n👟 اختر *الأحجام* المتوفرة ثم اضغط "تم":`,
      PT_SIZES_KEYBOARD
    );
    return;
  }

  // ── تيشيرت الطبعة: الأحجام ──────────────────────────
  if (data.startsWith('pt_size_')) {
    const size = data.replace('pt_size_', '');
    const cur  = session.pt_sizes ? session.pt_sizes.split(',').filter(Boolean) : [];
    const upd  = cur.includes(size) ? cur.filter(s=>s!==size) : [...cur, size];
    await setSession(chatId, { ...session, pt_sizes: upd.join(',') });
    await sendMessage(chatId,
      cur.includes(size)
        ? `❌ إزالة *${size}* | المختار: ${upd.join(', ')||'—'}`
        : `✅ إضافة *${size}* | المختار: ${upd.join(', ')}`,
      PT_SIZES_KEYBOARD
    );
    return;
  }
  if (data === 'pt_sizes_done') {
    const sizes = session.pt_sizes ? session.pt_sizes.split(',').filter(Boolean) : [];
    if (!sizes.length) { await sendMessage(chatId, '❌ اختر حجماً واحداً!', PT_SIZES_KEYBOARD); return; }
    await setSession(chatId, { ...session, step: 'pt_await_colors', pt_colors: '' });
    await sendMessage(chatId,
      `✅ الأحجام: *${sizes.join(', ')}*\n\n🎨 اختر *ألوان الطبعة* المتوفرة ثم اضغط "تم":`,
      PT_COLORS_KEYBOARD
    );
    return;
  }

  // ── تيشيرت الطبعة: الألوان ──────────────────────────
  if (data.startsWith('pt_color_')) {
    const color = data.replace('pt_color_', '');
    const cur   = session.pt_colors ? session.pt_colors.split(',').filter(Boolean) : [];
    const upd   = cur.includes(color) ? cur.filter(c=>c!==color) : [...cur, color];
    await setSession(chatId, { ...session, pt_colors: upd.join(',') });
    await sendMessage(chatId,
      cur.includes(color)
        ? `❌ إزالة *${color}* | المختار: ${upd.join(', ')||'—'}`
        : `✅ إضافة *${color}* | المختار: ${upd.join(', ')}`,
      PT_COLORS_KEYBOARD
    );
    return;
  }
  if (data === 'pt_colors_done') {
    const colors = session.pt_colors ? session.pt_colors.split(',').filter(Boolean) : [];
    if (!colors.length) { await sendMessage(chatId, '❌ اختر لون طبعة واحد على الأقل!', PT_COLORS_KEYBOARD); return; }
    await setSession(chatId, { ...session, step: 'pt_await_image', pt_images: '' });
    await sendMessage(chatId,
      `✅ الألوان: *${colors.join(', ')}*\n\n📸 أرسل *صورة التيشيرت* (الوجه الأمامي أولاً):\n\nبإمكانك رفع أكثر من صورة واحدة (أمامي + خلفي).`
    );
    return;
  }

  // ── تيشيرت الطبعة: حفظ بعد انتهاء الصور ────────────
  if (data === 'pt_images_done') {
    const images  = session.pt_images ? session.pt_images.split('||').filter(Boolean) : [];
    const sizes   = session.pt_sizes  ? session.pt_sizes.split(',').filter(Boolean)   : [];
    const colors  = session.pt_colors ? session.pt_colors.split(',').filter(Boolean)  : [];

    if (!images.length) { await sendMessage(chatId, '❌ أرسل صورة واحدة على الأقل.'); return; }

    try {
      await savePrintTshirt({
        name:        session.pt_name  || '',
        fabric:      session.pt_fabric|| '',
        printColors: colors,
        price:       session.pt_price || 0,
        oldPrice:    session.pt_oldPrice || null,
        desc:        session.pt_desc  || '',
        sizes,
        images
      });
      await clearSession(chatId);
      await sendMessage(chatId,
        `✅ *تم إضافة تيشيرت الطبعة!*\n\n` +
        `👕 ${session.pt_name}\n` +
        `🧵 القماش: ${session.pt_fabric}\n` +
        `🎨 الألوان: ${colors.join(', ')}\n` +
        `👟 الأحجام: ${sizes.join(', ')}\n` +
        `🖼 الصور: ${images.length} صورة\n` +
        `💰 ${Number(session.pt_price).toLocaleString()} د.ع`,
        MAIN_MENU
      );
    } catch (e) {
      await sendMessage(chatId, '❌ خطأ في حفظ التيشيرت.', MAIN_MENU);
      console.error(e);
    }
    return;
  }
}

// ============================================================
// نقطة الدخول — Vercel Handler
// ============================================================
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(200).json({ ok: true, message: 'Baki Admin Bot is running 🚀' });
  }
  try {
    const body = req.body;
    if (body.message)         await handleMessage(body.message);
    else if (body.callback_query) await handleCallback(body.callback_query);
  } catch (e) {
    console.error('Bot error:', e);
  }
  res.status(200).json({ ok: true });
}
