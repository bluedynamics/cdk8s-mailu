// Fix logo link to always go to documentation root
// Works for both local (/) and GitHub Pages (/cdk8s-mailu/)
document.addEventListener('DOMContentLoaded', function() {
  const logoLink = document.querySelector('.sy-head-brand');
  if (logoLink) {
    // Get the path up to /cdk8s-mailu/ (or just / for local)
    const pathMatch = window.location.pathname.match(/^(.*?\/cdk8s-mailu\/|\/)/);
    if (pathMatch) {
      logoLink.href = pathMatch[1];
    }
  }
});
