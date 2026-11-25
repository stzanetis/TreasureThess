// Fades page sections in as they scroll into view, and shadows the header once the page scrolls.
// Loaded in <head>: the "js" class is set before first paint, so hidden-until-revealed only applies with JS on.
document.documentElement.classList.add('js');

document.addEventListener('DOMContentLoaded', () => {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('visible');
      observer.unobserve(entry.target);
    });
  }, { threshold: 0.15 });

  const reveal = (el, index = 0) => {
    el.classList.add('reveal');
    el.style.setProperty('--i', index);
    observer.observe(el);
  };
  const groups = '.grid-2, .grid-3, .points, .collections';
  document.querySelectorAll('main section:not(.hero) .wrap > *').forEach((el) => {
    if (el.matches(groups)) [...el.children].forEach(reveal);
    else reveal(el);
  });

  const header = document.querySelector('header.site');
  const onScroll = () => header.classList.toggle('scrolled', window.scrollY > 8);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
});
