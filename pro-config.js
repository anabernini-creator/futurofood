/*
 * FuturoFood Pro — premium newsletter (US$7/month) on Beehiiv. NOT LIVE YET.
 *
 * While enabled is false, /pro shows a waitlist (free newsletter signup tagged
 * utm_campaign=pro-waitlist, so the list can be segmented in Beehiiv).
 * To launch: set up the paid tier in Beehiiv, paste its upgrade/checkout URL
 * in upgradeUrl, set enabled to true and bump ?v= where /pro loads this file.
 */
window.FF_PRO = {
  enabled: false,
  priceUsdMonthly: 7,
  upgradeUrl: "",
};
