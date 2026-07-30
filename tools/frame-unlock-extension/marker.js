// Tells the CMS that the extension is active, so the Browser page can drop its
// "this site refuses to load" warning.
//
// Content scripts run in an isolated JS world but share the DOM with the page,
// so an attribute is the simplest reliable channel between the two.
document.documentElement.setAttribute("data-cms-frame-unlock", "1");
