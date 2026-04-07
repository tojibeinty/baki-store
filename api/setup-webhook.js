// ============================================
// سكريبت لتسجيل الـ Webhook
// شغّله مرة وحدة بعد النشر على Vercel
// ============================================

// ضع هنا البيانات:
const ADMIN_BOT_TOKEN = 'YOUR_ADMIN_BOT_TOKEN';  // token البوت الإداري الجديد
const VERCEL_URL = 'https://YOUR_PROJECT.vercel.app'; // رابط Vercel مشروعك

async function setupWebhook() {
  const webhookUrl = `${VERCEL_URL}/api/bot`;
  
  console.log('🔗 تسجيل الـ Webhook:', webhookUrl);
  
  const res = await fetch(`https://api.telegram.org/bot${ADMIN_BOT_TOKEN}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: webhookUrl,
      allowed_updates: ['message', 'callback_query']
    })
  });
  
  const data = await res.json();
  
  if (data.ok) {
    console.log('✅ تم تسجيل الـ Webhook بنجاح!');
  } else {
    console.error('❌ خطأ:', data.description);
  }
}

setupWebhook();
