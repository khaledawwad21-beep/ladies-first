// Run this once in the current Ladies First store page console to export prototype data.
// Do NOT publish the resulting JSON or send it to anyone; it can contain customer data.
(() => {
  const keys = ['lf_products','lf_orders','lf_users','lf_coupons','lf_cats','lf_brands','lf_packaging_options','lf_waitlist','lf_hero','lf_hero_slides','lf_hero_text_style','lf_social_links'];
  const out = { exportedAt: new Date().toISOString(), data: {} };
  for (const k of keys) {
    try { out.data[k] = JSON.parse(localStorage.getItem(k) || 'null'); }
    catch { out.data[k] = null; }
  }
  const blob = new Blob([JSON.stringify(out, null, 2)], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'ladies-first-localstorage-export.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
})();
