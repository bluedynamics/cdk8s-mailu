// Add package name text next to logo (JavaScript fallback if CSS doesn't work)
document.addEventListener('DOMContentLoaded', function() {
  // Find the logo link (try multiple selectors)
  const logoSelectors = [
    '.sy-h-logo a',
    'header a[href="/"]',
    'nav a[href="/"]',
    'a.logo',
    '.logo a'
  ];

  let logoLink = null;
  for (const selector of logoSelectors) {
    logoLink = document.querySelector(selector);
    if (logoLink) {
      console.log('Found logo with selector:', selector);
      break;
    }
  }

  if (logoLink) {
    // Check if text already exists (via CSS ::after)
    const computedContent = window.getComputedStyle(logoLink, '::after').getPropertyValue('content');
    console.log('CSS ::after content:', computedContent);

    // If CSS didn't work, add text via JavaScript
    if (computedContent === 'none' || computedContent === '""') {
      const textSpan = document.createElement('span');
      textSpan.textContent = 'cdk8s-mailu';
      textSpan.style.fontFamily = 'Orbitron, sans-serif';
      textSpan.style.fontWeight = '700';
      textSpan.style.fontSize = '1.5rem';
      textSpan.style.color = '#00d4ff';
      textSpan.style.textTransform = 'uppercase';
      textSpan.style.letterSpacing = '2px';
      textSpan.style.marginLeft = '1rem';
      logoLink.appendChild(textSpan);
      console.log('Added logo text via JavaScript');
    }
  } else {
    console.warn('Logo link not found');
  }
});
