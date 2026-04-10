// ============================================
// باكي ستور — بوت إداري على Vercel
// الملف: api/bot.js
// ============================================

const FIREBASE_PROJECT = 'baki-store-9bc21';
const FIREBASE_API_KEY = 'AIzaSyDNyLcBRcVOQ5jxWlML1Jk0GNaOfybPqLM';
const FS_BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT}/databases/(default)/documents`;

const BOT_TOKEN = '7951459262:AAGo1UOG5K5_t6onmt65yctR6KIyIA2se58';       // 👈 token البوت من BotFather
const ADMIN_CHAT_ID = '6263195701'; // 👈 chat_id حسابك من @userinfobot

// ============ Cloudinary ============
const CLOUDINARY_CLOUD = 'dx2drikbu';
const CLOUDINARY_API_KEY = '928216213266583';
const CLOUDINARY_API_SECRET = 'xuJxppmIZ920Xs8HSIuYgLGeEWI';

async function uploadToCloudinary(imageBuffer, filename) {
  const crypto = await import('crypto');
  const timestamp = Math.floor(Date.now() / 1000);
  const folder = 'baki-store';

  // Cloudinary signature: SHA1(param_string + api_secret)
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

// ============ حالة المحادثة (في الذاكرة — Vercel serverless) ============
// ملاحظة: Vercel serverless لا يحتفظ بالحالة بين الطلبات
// لذا نستخدم Firebase لحفظ حالة المحادثة
const SESSIONS_COLLECTION = 'bot_sessions';

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
  } catch(e) {
    // إذا ما موجود، اعمل doc جديد
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
  const body = {
    chat_id: chatId,
    text,
    parse_mode: 'Markdown'
  };
  if (keyboard) body.reply_markup = keyboard;
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

// ============ قوائم inline ============
const MAIN_MENU = {
  inline_keyboard: [
    [{ text: '➕ إضافة منتج', callback_data: 'add_product' }],
    [{ text: '📦 عرض المنتجات', callback_data: 'list_products' }],
    [{ text: '🗑 حذف منتج', callback_data: 'delete_product' }],
    [{ text: '🎟 إضافة كوبون', callback_data: 'add_coupon' }],
    [{ text: '🎟 عرض الكوبونات', callback_data: 'list_coupons' }],
    [{ text: '👕 إضافة تيشيرت للطبعات', callback_data: 'add_tshirt' }],
    [{ text: '🖼 إضافة طبعة للمكتبة', callback_data: 'add_design' }],
    [{ text: '📊 إحصائيات', callback_data: 'stats' }],
  ]
};

const CAT_KEYBOARD = {
  inline_keyboard: [
    [{ text: '👕 رجالي', callback_data: 'cat_men' }],
    [{ text: '👗 نسائي', callback_data: 'cat_women' }],
    [{ text: '🎒 اكسسوارات', callback_data: 'cat_accessories' }],
  ]
};

const SIZES_KEYBOARD = {
  inline_keyboard: [
    [
      { text: 'XS', callback_data: 'size_XS' },
      { text: 'S', callback_data: 'size_S' },
      { text: 'M', callback_data: 'size_M' },
    ],
    [
      { text: 'L', callback_data: 'size_L' },
      { text: 'XL', callback_data: 'size_XL' },
      { text: 'XXL', callback_data: 'size_XXL' },
    ],
    [{ text: '✅ تم اختيار الأحجام', callback_data: 'sizes_done' }],
  ]
};

const FABRIC_KEYBOARD = {
  inline_keyboard: [
    [{ text: 'قطني 100%', callback_data: 'fabric_قطني 100%' }],
    [{ text: 'قماش أديداس', callback_data: 'fabric_قماش أديداس' }],
    [{ text: 'قماش نايك', callback_data: 'fabric_قماش نايك' }],
    [{ text: 'بوليستر', callback_data: 'fabric_بوليستر' }],
    [{ text: 'قطني بوليستر', callback_data: 'fabric_قطني بوليستر' }],
    [{ text: 'اوفر سايز', callback_data: 'fabric_اوفر سايز' }],
  ]
};

const COLORS_KEYBOARD = {
  inline_keyboard: [
    [{ text: '⚫ أسود', callback_data: 'color_أسود' }, { text: '⚪ أبيض', callback_data: 'color_أبيض' }],
    [{ text: '🔴 أحمر', callback_data: 'color_أحمر' }, { text: '🔵 أزرق داكن', callback_data: 'color_أزرق داكن' }],
    [{ text: '🟢 أخضر', callback_data: 'color_أخضر' }, { text: '🟡 أصفر', callback_data: 'color_أصفر' }],
    [{ text: '🟤 بني', callback_data: 'color_بني' }, { text: '🩶 رمادي', callback_data: 'color_رمادي' }],
    [{ text: '✅ تم اختيار الألوان', callback_data: 'colors_done' }],
  ]
};

const BADGE_KEYBOARD = {
  inline_keyboard: [
    [{ text: '🔥 NEW', callback_data: 'badge_NEW' }, { text: '⭐ SALE', callback_data: 'badge_SALE' }],
    [{ text: '💎 HOT', callback_data: 'badge_HOT' }, { text: 'بدون باج', callback_data: 'badge_none' }],
  ]
};

// ============ منطق المنتجات ============
async function listProducts() {
  try {
    const data = await fsGet('products');
    if (!data?.documents || data.documents.length === 0) return '📦 لا توجد منتجات حالياً.';
    const catLabels = { men: 'رجالي', women: 'نسائي', accessories: 'اكسسوارات' };
    return data.documents.map((d, i) => {
      const f = d.fields || {};
      const name = f.name?.stringValue || 'بدون اسم';
      const price = f.price?.integerValue || f.price?.doubleValue || 0;
      const cat = catLabels[f.cat?.stringValue] || f.cat?.stringValue || '';
      const docId = d.name.split('/').pop();
      return `${i + 1}. *${name}* — ${Number(price).toLocaleString()} د.ع — ${cat}\n   ID: \`${docId}\``;
    }).join('\n\n');
  } catch { return '❌ خطأ في تحميل المنتجات'; }
}

async function deleteProductById(docId) {
  try {
    await fsDelete('products', docId);
    return true;
  } catch { return false; }
}

async function saveProduct(product) {
  await fsPost('products', {
    id: { integerValue: Date.now() },
    name: { stringValue: product.name },
    cat: { stringValue: product.cat },
    price: { integerValue: parseInt(product.price) },
    oldPrice: product.oldPrice ? { integerValue: parseInt(product.oldPrice) } : { nullValue: null },
    desc: { stringValue: product.desc || '' },
    badge: { stringValue: product.badge || '' },
    sizes: { arrayValue: { values: (product.sizes || []).map(s => ({ stringValue: s })) } },
    images: { arrayValue: { values: [{ stringValue: product.image || '' }] } }
  });
}

// ============ منطق الكوبونات ============
async function listCoupons() {
  try {
    const data = await fsGet('coupons');
    if (!data?.documents || data.documents.length === 0) return '🎟 لا توجد كوبونات حالياً.';
    return data.documents.map((d, i) => {
      const f = d.fields || {};
      const code = f.code?.stringValue || '';
      const discount = f.discount?.integerValue || f.discount?.doubleValue || 0;
      const usesLeft = f.usesLeft?.integerValue || f.usesLeft?.doubleValue || 0;
      const docId = d.name.split('/').pop();
      return `${i + 1}. *${code}* — خصم ${discount}% — متبقي ${usesLeft}\n   ID: \`${docId}\``;
    }).join('\n\n');
  } catch { return '❌ خطأ في تحميل الكوبونات'; }
}

async function getStats() {
  try {
    const [products, coupons, analytics] = await Promise.all([
      fsGet('products'),
      fsGet('coupons'),
      fsGet('analytics')
    ]);
    const prodCount = products?.documents?.length || 0;
    const couponCount = coupons?.documents?.length || 0;
    const today = new Date().toLocaleDateString('ar-IQ').replace(/\//g, '-');
    let todayVisits = 0;
    if (analytics?.documents) {
      const todayDoc = analytics.documents.find(d => d.name.includes(`visits-${today}`));
      if (todayDoc) todayVisits = parseInt(todayDoc.fields?.visits?.integerValue || 0);
    }
    return `📊 *إحصائيات باكي ستور*\n\n📦 المنتجات: ${prodCount}\n🎟 الكوبونات: ${couponCount}\n👁 زيارات اليوم: ${todayVisits}`;
  } catch { return '❌ خطأ في تحميل الإحصائيات'; }
}

// ============ دوال التيشيرتات والطبعات ============
async function saveTshirt(t) {
  await fsPost('custom_tshirts', {
    id: { integerValue: Date.now() },
    name: { stringValue: t.name },
    fabric: { stringValue: t.fabric || '' },
    price: { integerValue: parseInt(t.price) },
    oldPrice: t.oldPrice ? { integerValue: parseInt(t.oldPrice) } : { nullValue: null },
    desc: { stringValue: t.desc || '' },
    sizes: { arrayValue: { values: (t.sizes || []).map(s => ({ stringValue: s })) } },
    colors: { arrayValue: { values: (t.colors || []).map(c => ({ stringValue: c })) } },
    images: { arrayValue: { values: [{ stringValue: t.image || '' }] } }
  });
}

async function saveDesign(d) {
  await fsPost('designs', {
    id: { integerValue: Date.now() },
    name: { stringValue: d.name },
    image: { stringValue: d.image || '' }
  });
}

// ============ معالج الرسائل الرئيسي ============
async function handleMessage(msg) {
  const chatId = String(msg.chat?.id);
  const text = msg.text || '';
  const photo = msg.photo;

  // تحقق من الصلاحية
  if (chatId !== ADMIN_CHAT_ID) {
    await sendMessage(chatId, '🚫 غير مصرح لك باستخدام هذا البوت.');
    return;
  }

  const session = await getSession(chatId);
  const step = session.step || '';

  // ============ أوامر رئيسية ============
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

  // ============ خطوات إضافة منتج ============
  if (step === 'await_name') {
    await setSession(chatId, { ...session, step: 'await_price', name: text });
    await sendMessage(chatId, '💰 أدخل *السعر* (بالدينار العراقي، أرقام فقط):');
    return;
  }

  if (step === 'await_price') {
    if (isNaN(text.trim())) { await sendMessage(chatId, '❌ أدخل رقماً صحيحاً للسعر:'); return; }
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
    let imageUrl = text.trim();
    if (!imageUrl.startsWith('http')) { await sendMessage(chatId, '❌ أرسل رابط صحيح يبدأ بـ https://'); return; }
    await setSession(chatId, { ...session, step: 'await_badge', image: imageUrl });
    await sendMessage(chatId, '🏅 اختر *الباج* (الشارة على المنتج):', BADGE_KEYBOARD);
    return;
  }

  if (step === 'await_image_file') {
    // المستخدم أرسل صورة مباشرة
    if (photo && photo.length > 0) {
      await sendMessage(chatId, '⏳ جاري رفع الصورة على Cloudinary...');
      try {
        const fileId = photo[photo.length - 1].file_id;
        // احصل على مسار الملف من تيليغرام
        const fileRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${fileId}`);
        const fileData = await fileRes.json();
        const filePath = fileData.result?.file_path;
        // حمّل الصورة من تيليغرام
        const tgImageRes = await fetch(`https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`);
        const imageBuffer = await tgImageRes.arrayBuffer();
        // ارفعها على Cloudinary
        const cloudUrl = await uploadToCloudinary(imageBuffer, filePath.split('/').pop());
        await setSession(chatId, { ...session, step: 'await_badge', image: cloudUrl });
        await sendMessage(chatId, '✅ تم رفع الصورة بنجاح!\n\n🏅 اختر *الباج* (الشارة على المنتج):', BADGE_KEYBOARD);
      } catch (e) {
        await sendMessage(chatId, '❌ فشل رفع الصورة، حاول مرة ثانية.');
        console.error('Cloudinary error:', e);
      }
    } else if (text && text.startsWith('http')) {
      // المستخدم أرسل رابط — ارفعه على Cloudinary أيضاً
      await sendMessage(chatId, '⏳ جاري رفع الصورة...');
      try {
        const imgRes = await fetch(text.trim());
        const imageBuffer = await imgRes.arrayBuffer();
        const cloudUrl = await uploadToCloudinary(imageBuffer, 'product.jpg');
        await setSession(chatId, { ...session, step: 'await_badge', image: cloudUrl });
        await sendMessage(chatId, '✅ تم رفع الصورة!\n\n🏅 اختر *الباج*:', BADGE_KEYBOARD);
      } catch {
        await sendMessage(chatId, '❌ فشل رفع الصورة، تأكد من الرابط وحاول مرة ثانية.');
      }
    } else {
      await sendMessage(chatId, '📸 أرسل *صورة* مباشرة من جهازك، أو أرسل *رابط* صورة يبدأ بـ https://');
    }
    return;
  }

  // ============ خطوات حذف منتج ============
  if (step === 'await_delete_id') {
    const docId = text.trim();
    const ok = await deleteProductById(docId);
    await clearSession(chatId);
    if (ok) await sendMessage(chatId, '✅ تم حذف المنتج بنجاح!', MAIN_MENU);
    else await sendMessage(chatId, '❌ ما قدرت أحذف المنتج. تأكد من الـ ID.', MAIN_MENU);
    return;
  }

  // ============ خطوات إضافة كوبون ============
  if (step === 'await_coupon_code') {
    await setSession(chatId, { ...session, step: 'await_coupon_discount', couponCode: text.trim().toUpperCase() });
    await sendMessage(chatId, '💸 أدخل *نسبة الخصم* (رقم من 1 إلى 100):');
    return;
  }

  if (step === 'await_coupon_discount') {
    const d = parseInt(text.trim());
    if (isNaN(d) || d < 1 || d > 100) { await sendMessage(chatId, '❌ أدخل رقماً من 1 إلى 100:'); return; }
    await setSession(chatId, { ...session, step: 'await_coupon_uses', couponDiscount: d });
    await sendMessage(chatId, '🔢 أدخل *عدد مرات الاستخدام*:');
    return;
  }

  if (step === 'await_coupon_uses') {
    const uses = parseInt(text.trim());
    if (isNaN(uses) || uses < 1) { await sendMessage(chatId, '❌ أدخل رقماً صحيحاً:'); return; }
    try {
      await fsPost('coupons', {
        code: { stringValue: session.couponCode },
        discount: { integerValue: parseInt(session.couponDiscount) },
        usesLeft: { integerValue: uses }
      });
      await clearSession(chatId);
      await sendMessage(chatId, `✅ تم إضافة كوبون *${session.couponCode}* بنجاح!\nخصم: ${session.couponDiscount}%\nمرات الاستخدام: ${uses}`, MAIN_MENU);
    } catch {
      await sendMessage(chatId, '❌ خطأ في الحفظ.', MAIN_MENU);
    }
    return;
  }

  // ============ خطوات إضافة تيشيرت للطبعات ============
  if (step === 'await_tshirt_name') {
    await setSession(chatId, { ...session, step: 'await_tshirt_price', tshirtName: text.trim() });
    await sendMessage(chatId, '💰 أدخل *السعر* (بالدينار العراقي):');
    return;
  }

  if (step === 'await_tshirt_price') {
    if (isNaN(text.trim())) { await sendMessage(chatId, '❌ أدخل رقماً صحيحاً:'); return; }
    await setSession(chatId, { ...session, step: 'await_tshirt_oldprice', tshirtPrice: text.trim() });
    await sendMessage(chatId, '🏷 أدخل *السعر القديم* (أو أرسل 0 إذا ما في خصم):');
    return;
  }

  if (step === 'await_tshirt_oldprice') {
    const op = text.trim() === '0' ? '' : text.trim();
    await setSession(chatId, { ...session, step: 'await_tshirt_desc', tshirtOldPrice: op });
    await sendMessage(chatId, '📝 أدخل *وصف* التيشيرت (أو أرسل - للتخطي):');
    return;
  }

  if (step === 'await_tshirt_desc') {
    const desc = text.trim() === '-' ? '' : text.trim();
    await setSession(chatId, { ...session, step: 'await_tshirt_fabric', tshirtDesc: desc });
    await sendMessage(chatId, '🧵 اختر *نوع القماش*:', FABRIC_KEYBOARD);
    return;
  }

  if (step === 'await_tshirt_image') {
    if (photo && photo.length > 0) {
      await sendMessage(chatId, '⏳ جاري رفع الصورة...');
      try {
        const fileId = photo[photo.length - 1].file_id;
        const fileRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${fileId}`);
        const fileData = await fileRes.json();
        const filePath = fileData.result?.file_path;
        const tgImageRes = await fetch(`https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`);
        const imageBuffer = await tgImageRes.arrayBuffer();
        const cloudUrl = await uploadToCloudinary(imageBuffer, filePath.split('/').pop());
        await setSession(chatId, { ...session, step: 'await_tshirt_save', tshirtImage: cloudUrl });
        await sendMessage(chatId, '✅ تم رفع الصورة!\n\nاضغط *حفظ* للإضافة:', {
          inline_keyboard: [[{ text: '💾 حفظ التيشيرت', callback_data: 'save_tshirt' }]]
        });
      } catch {
        await sendMessage(chatId, '❌ فشل رفع الصورة، حاول مرة ثانية.');
      }
    } else if (text && text.startsWith('http')) {
      await setSession(chatId, { ...session, step: 'await_tshirt_save', tshirtImage: text.trim() });
      await sendMessage(chatId, '✅ تم!\n\nاضغط *حفظ* للإضافة:', {
        inline_keyboard: [[{ text: '💾 حفظ التيشيرت', callback_data: 'save_tshirt' }]]
      });
    } else {
      await sendMessage(chatId, '📸 أرسل صورة مباشرة أو رابط يبدأ بـ https://');
    }
    return;
  }

  // ============ خطوات إضافة طبعة للمكتبة ============
  if (step === 'await_design_name') {
    await setSession(chatId, { ...session, step: 'await_design_image', designName: text.trim() });
    await sendMessage(chatId, '🖼 أرسل *صورة الطبعة* (PNG شفاف أفضل) أو رابط مباشر:');
    return;
  }

  if (step === 'await_design_image') {
    if (photo && photo.length > 0) {
      await sendMessage(chatId, '⏳ جاري رفع الطبعة...');
      try {
        const fileId = photo[photo.length - 1].file_id;
        const fileRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getFile?file_id=${fileId}`);
        const fileData = await fileRes.json();
        const filePath = fileData.result?.file_path;
        const tgImageRes = await fetch(`https://api.telegram.org/file/bot${BOT_TOKEN}/${filePath}`);
        const imageBuffer = await tgImageRes.arrayBuffer();
        const cloudUrl = await uploadToCloudinary(imageBuffer, filePath.split('/').pop());
        await saveDesign({ name: session.designName, image: cloudUrl });
        await clearSession(chatId);
        await sendMessage(chatId, `✅ *تمت إضافة الطبعة بنجاح!*\n\n🖼 الاسم: ${session.designName}`, MAIN_MENU);
      } catch {
        await sendMessage(chatId, '❌ فشل رفع الطبعة، حاول مرة ثانية.');
      }
    } else if (text && text.startsWith('http')) {
      await saveDesign({ name: session.designName, image: text.trim() });
      await clearSession(chatId);
      await sendMessage(chatId, `✅ *تمت إضافة الطبعة بنجاح!*\n\n🖼 الاسم: ${session.designName}`, MAIN_MENU);
    } else {
      await sendMessage(chatId, '📸 أرسل صورة مباشرة أو رابط يبدأ بـ https://');
    }
    return;
  }

  // fallback
  await sendMessage(chatId, '👇 استخدم /start للقائمة الرئيسية', MAIN_MENU);
}

// ============ معالج الـ Callback (أزرار inline) ============
async function handleCallback(cb) {
  const chatId = String(cb.message?.chat?.id);
  const data = cb.data;
  const msgId = cb.message?.message_id;

  if (chatId !== ADMIN_CHAT_ID) return;

  const session = await getSession(chatId);

  // أجب على الـ callback فوراً
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: cb.id })
  });

  // ============ القائمة الرئيسية ============
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
    await sendMessage(chatId, `🗑 *حذف منتج*\n\n${list}\n\nأرسل *ID* المنتج اللي تريد تحذفه:`);
    return;
  }

  if (data === 'add_coupon') {
    await setSession(chatId, { step: 'await_coupon_code' });
    await sendMessage(chatId, '🎟 *إضافة كوبون جديد*\n\nأدخل *كود* الكوبون (مثال: BAKI20):');
    return;
  }

  if (data === 'list_coupons') {
    const list = await listCoupons();
    await sendMessage(chatId, `🎟 *الكوبونات الحالية:*\n\n${list}`, MAIN_MENU);
    return;
  }

  if (data === 'stats') {
    const stats = await getStats();
    await sendMessage(chatId, stats, MAIN_MENU);
    return;
  }

  // ============ اختيار القسم ============
  if (data.startsWith('cat_')) {
    const cat = data.replace('cat_', '');
    await setSession(chatId, { ...session, step: 'await_sizes', cat, sizes: '' });
    await sendMessage(chatId, '👟 اختر *الأحجام* المتوفرة (اضغط واحد واحد ثم اضغط "تم"):', SIZES_KEYBOARD);
    return;
  }

  // ============ اختيار الأحجام ============
  if (data.startsWith('size_')) {
    const size = data.replace('size_', '');
    const currentSizes = session.sizes ? session.sizes.split(',').filter(Boolean) : [];
    let newSizes;
    if (currentSizes.includes(size)) {
      newSizes = currentSizes.filter(s => s !== size);
      await sendMessage(chatId, `❌ تم إزالة حجم *${size}*\nالأحجام المختارة: ${newSizes.join(', ') || 'لا شيء'}`, SIZES_KEYBOARD);
    } else {
      newSizes = [...currentSizes, size];
      await sendMessage(chatId, `✅ تم إضافة حجم *${size}*\nالأحجام المختارة: ${newSizes.join(', ')}`, SIZES_KEYBOARD);
    }
    await setSession(chatId, { ...session, sizes: newSizes.join(',') });
    return;
  }

  if (data === 'sizes_done') {
    const sizes = session.sizes ? session.sizes.split(',').filter(Boolean) : [];
    if (sizes.length === 0) {
      await sendMessage(chatId, '❌ اختر حجماً واحداً على الأقل!', SIZES_KEYBOARD);
      return;
    }
    await setSession(chatId, { ...session, step: 'await_image_file' });
    await sendMessage(chatId, `✅ الأحجام: *${sizes.join(', ')}*\n\n🖼 أرسل *صورة* المنتج مباشرةً، أو أرسل *رابط* صورة من imgbb.com:\n\nhttps://imgbb.com\n\n_(أرسل /cancel للإلغاء)_`);
    return;
  }

  // ============ إضافة تيشيرت للطبعات ============
  if (data === 'add_tshirt') {
    await setSession(chatId, { step: 'await_tshirt_name' });
    await sendMessage(chatId, '👕 *إضافة تيشيرت للطبعات*\n\nأدخل *اسم* التيشيرت:\n\n_(أرسل /cancel للإلغاء)_');
    return;
  }

  if (data === 'add_design') {
    await setSession(chatId, { step: 'await_design_name' });
    await sendMessage(chatId, '🖼 *إضافة طبعة للمكتبة*\n\nأدخل *اسم* الطبعة:\n\n_(أرسل /cancel للإلغاء)_');
    return;
  }

  // ============ اختيار القماش ============
  if (data.startsWith('fabric_')) {
    const fabric = data.replace('fabric_', '');
    await setSession(chatId, { ...session, step: 'await_tshirt_colors', tshirtFabric: fabric, tshirtColors: '' });
    await sendMessage(chatId, `✅ القماش: *${fabric}*

🎨 اختر *ألوان* التيشيرت (اضغط واحد واحد ثم "تم"):`, COLORS_KEYBOARD);
    return;
  }

  // ============ اختيار الألوان ============
  if (data.startsWith('color_')) {
    const color = data.replace('color_', '');
    const currentColors = session.tshirtColors ? session.tshirtColors.split(',').filter(Boolean) : [];
    let newColors;
    if (currentColors.includes(color)) {
      newColors = currentColors.filter(c => c !== color);
      await sendMessage(chatId, `❌ تم إزالة لون *${color}*
الألوان المختارة: ${newColors.join(', ') || 'لا شيء'}`, COLORS_KEYBOARD);
    } else {
      newColors = [...currentColors, color];
      await sendMessage(chatId, `✅ تم إضافة لون *${color}*
الألوان المختارة: ${newColors.join(', ')}`, COLORS_KEYBOARD);
    }
    await setSession(chatId, { ...session, tshirtColors: newColors.join(',') });
    return;
  }

  if (data === 'colors_done') {
    const colors = session.tshirtColors ? session.tshirtColors.split(',').filter(Boolean) : [];
    if (colors.length === 0) {
      await sendMessage(chatId, '❌ اختر لوناً واحداً على الأقل!', COLORS_KEYBOARD);
      return;
    }
    await setSession(chatId, { ...session, step: 'await_tshirt_sizes', tshirtColors: colors.join(','), sizes: '' });
    await sendMessage(chatId, `✅ الألوان: *${colors.join(', ')}*

👟 اختر *الأحجام* المتوفرة:`, SIZES_KEYBOARD);
    return;
  }

  if (data === 'sizes_done' && session.step === 'await_tshirt_sizes') {
    const sizes = session.sizes ? session.sizes.split(',').filter(Boolean) : [];
    if (sizes.length === 0) {
      await sendMessage(chatId, '❌ اختر حجماً واحداً على الأقل!', SIZES_KEYBOARD);
      return;
    }
    await setSession(chatId, { ...session, step: 'await_tshirt_image' });
    await sendMessage(chatId, `✅ الأحجام: *${sizes.join(', ')}*

📸 أرسل *صورة* التيشيرت أو رابط مباشر:`);
    return;
  }

  if (data === 'save_tshirt') {
    const sizes = session.sizes ? session.sizes.split(',').filter(Boolean) : [];
    const colors = session.tshirtColors ? session.tshirtColors.split(',').filter(Boolean) : [];
    try {
      await saveTshirt({
        name: session.tshirtName,
        fabric: session.tshirtFabric,
        price: session.tshirtPrice,
        oldPrice: session.tshirtOldPrice || null,
        desc: session.tshirtDesc || '',
        sizes,
        colors,
        image: session.tshirtImage || ''
      });
      await clearSession(chatId);
      await sendMessage(chatId,
        `✅ *تمت إضافة التيشيرت بنجاح!*

` +
        `👕 الاسم: ${session.tshirtName}
` +
        `🧵 القماش: ${session.tshirtFabric}
` +
        `💰 السعر: ${Number(session.tshirtPrice).toLocaleString()} د.ع
` +
        `🎨 الألوان: ${colors.join(', ')}
` +
        `👟 الأحجام: ${sizes.join(', ')}`,
        MAIN_MENU
      );
    } catch {
      await sendMessage(chatId, '❌ خطأ في حفظ التيشيرت.', MAIN_MENU);
    }
    return;
  }

  // ============ اختيار الباج ============
  if (data.startsWith('badge_')) {
    const badge = data.replace('badge_', '') === 'none' ? '' : data.replace('badge_', '');
    const sizes = session.sizes ? session.sizes.split(',').filter(Boolean) : [];
    const product = {
      name: session.name,
      cat: session.cat,
      price: session.price,
      oldPrice: session.oldPrice || null,
      desc: session.desc || '',
      badge,
      sizes,
      image: session.image || ''
    };
    try {
      await saveProduct(product);
      await clearSession(chatId);
      await sendMessage(chatId,
        `✅ *تم إضافة المنتج بنجاح!*\n\n` +
        `📦 الاسم: ${product.name}\n` +
        `💰 السعر: ${Number(product.price).toLocaleString()} د.ع\n` +
        `📂 القسم: ${product.cat}\n` +
        `👟 الأحجام: ${sizes.join(', ')}\n` +
        `🏅 الباج: ${badge || 'بدون'}`,
        MAIN_MENU
      );
    } catch {
      await sendMessage(chatId, '❌ خطأ في حفظ المنتج.', MAIN_MENU);
    }
    return;
  }
}

// ============ نقطة الدخول الرئيسية (Vercel Handler) ============
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(200).json({ ok: true, message: 'Baki Admin Bot is running 🚀' });
  }

  try {
    const body = req.body;
    if (body.message) {
      await handleMessage(body.message);
    } else if (body.callback_query) {
      await handleCallback(body.callback_query);
    }
  } catch (e) {
    console.error('Bot error:', e);
  }

  res.status(200).json({ ok: true });
}
