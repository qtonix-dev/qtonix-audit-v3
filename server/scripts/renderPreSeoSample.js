// Render the Pre-SEO report template with the StrataSound sample data → PDF.
const fs = require('fs');
const path = require('path');
const Handlebars = require('handlebars');
const { execFileSync } = require('child_process');

Handlebars.registerHelper('inc', (i) => i + 1);
Handlebars.registerHelper('lower', (s) => String(s || '').toLowerCase().replace(/[^a-z]/g, ''));

const RED = '#dc2626', AMBER = '#f59e0b', GREEN = '#16a34a';
const data = {
  forWeb: false,
  fontDir: 'file://' + path.join(process.env.HOME || '/home/claude', '.fonts'),
  report: {
    businessName: 'StrataSound Music', shortName: 'StrataSound', domain: 'stratasoundmusic.com',
    monthYear: 'OCTOBER 2026', auditDate: '9 October 2026', pagesReviewed: 9,
    preparedBy: 'Adam G, Project Manager', contactEmail: 'adam@qtonix.com', contactPhone: '+91-8249016547',
    healthScore: { value: 21, deg: Math.round(21 / 100 * 360) },
  },
  toc: [
    { n: '01', t: 'Overall Site Observation', d: 'Health score, top issues and what is already working' },
    { n: '02', t: 'Search Visibility Stats', d: 'Organic traffic, keywords and Google index check' },
    { n: '03', t: 'Technical SEO Stats', d: 'Meta robots, robots.txt, XML sitemap, response codes' },
    { n: '04', t: 'Page Performance & Mobile', d: 'PageSpeed, Core Web Vitals, page size, responsiveness' },
    { n: '05', t: 'On Page SEO Stats', d: 'Titles, descriptions, headings, images, schema, social tags' },
    { n: '06', t: 'Content Quality & Trust', d: 'Dummy text, testimonials, thin pages, E-E-A-T' },
    { n: '07', t: 'Site Architecture', d: 'Menu, URLs, internal linking and page structure' },
    { n: '08', t: 'Off Page Stats', d: 'Backlink profile, authority and link opportunities' },
    { n: '09', t: 'Competitor Overview', d: 'How the AI music market looks in search' },
    { n: '10', t: 'Keyword Opportunity Map', d: 'The searches each page should target' },
    { n: '11', t: 'AI Search Visibility', d: 'ChatGPT, Perplexity, Gemini and Google AI Overviews' },
    { n: '12', t: 'Tracking & Social Profiles', d: 'Analytics setup and social media presence' },
    { n: '13', t: 'Baseline KPIs', d: 'The starting numbers we will report progress against' },
    { n: '14', t: 'Action Plan & Approval', d: 'What we will do after approval, plus approval checklist' },
  ],
  ch1: {
    stats: [
      { v: '9 / 9', l: 'pages blocked from Google (noindex)' },
      { v: '0', l: 'pages indexed in Google & Bing' },
      { v: '0 / 9', l: 'pages with a meta description' },
      { v: '24', l: 'backlinks, 0 of good quality' },
    ],
    homepageNotes: [
      'The website looks modern and all the main sections are in place: Songs, About Us, Leaderboard, Singing and Contact Us. But during the audit we found that search engines are blocked from indexing the whole website. Because of this, the site is not showing on Google or Bing right now, not even when someone searches the brand name.',
      'Along with this there are a few on-page, content and tracking gaps which should be fixed before we start the launch campaign. A low starting score is normal for a site that has just launched, and most of the gap comes from fixes we can make in the first week.',
    ],
    healthBars: [
      { n: 'Crawling & Indexing', s: 1, pct: 10, color: RED }, { n: 'On-Page SEO', s: 3, pct: 30, color: AMBER },
      { n: 'Content & Trust', s: 2, pct: 20, color: RED }, { n: 'Speed & Core Web Vitals', s: 4, pct: 40, color: AMBER },
      { n: 'Mobile & UX Basics', s: 6, pct: 60, color: GREEN }, { n: 'Schema & Social Tags', s: 0, pct: 3, color: RED },
      { n: 'Backlinks & Authority', s: 1, pct: 10, color: RED }, { n: 'Tracking & Measurement', s: 1, pct: 10, color: RED },
      { n: 'AI Search Visibility', s: 0, pct: 3, color: RED }, { n: 'Brand & Social Presence', s: 3, pct: 30, color: AMBER },
    ],
    topIssues: [
      { issue: 'Every page carries a noindex, nofollow tag, so Google and Bing are told not to list the site.', priority: 'CRITICAL' },
      { issue: 'No XML sitemap. WordPress switches it off while the noindex setting is on.', priority: 'CRITICAL' },
      { issue: 'Dummy text and sample content is live on Home, Songs and Leaderboard pages.', priority: 'HIGH' },
      { issue: 'Titles show only the brand / page name and no page has a meta description.', priority: 'HIGH' },
      { issue: 'No Google Analytics, Search Console or Bing Webmaster Tools found.', priority: 'HIGH' },
    ],
    working: ['HTTPS is active on all pages', 'Canonical tags are correct on every page', 'Robots.txt does not block search or AI crawlers', 'One clear H1 on each page, clean short URLs', 'Mobile friendly with a custom 404 page', 'Legal pages published, social profiles linked'],
    fixing: ['Noindex tag on all 9 pages', 'No XML sitemap', 'No meta descriptions, brand-only titles', 'Dummy text and sample testimonials', 'No schema or social sharing tags', 'No tracking or search console setup'],
    summary: [
      { el: 'Website visible on Google / Bing', status: 'FAIL', remark: 'All pages have noindex tag' },
      { el: 'XML Sitemap', status: 'FAIL', remark: 'Not found' },
      { el: 'Robots.txt', status: 'PASS', remark: 'Present, sitemap line missing' },
      { el: 'HTTPS / SSL', status: 'PASS', remark: 'Active' },
      { el: 'Canonical Tags', status: 'PASS', remark: 'Present on all pages' },
      { el: 'Meta Titles optimized', status: 'FAIL', remark: 'Only brand / page name, no keywords' },
      { el: 'Meta Descriptions', status: 'FAIL', remark: 'Missing on all 9 pages' },
      { el: 'Original content (no dummy text)', status: 'FAIL', remark: 'Dummy text found on 3 pages' },
      { el: 'Schema Markup', status: 'FAIL', remark: 'Not found' },
      { el: 'Google Analytics / Search Console', status: 'FAIL', remark: 'Not found' },
      { el: 'Quality Backlinks', status: 'FAIL', remark: '0 (24 low value, nofollow)' },
      { el: 'Mobile Friendly', status: 'PASS', remark: 'Layout adjusts well' },
    ],
    keyTakeaway: 'The most important issue is the noindex tag on every page. Until it is removed, no other SEO work can bring results. Our team can fix it quickly once you approve the plan and share access, and it will be the first task we take up.',
    about: 'This report shows where stratasoundmusic.com stands today. Every fix listed here will be carried out by the Qtonix team once you approve the plan. Nothing needs to be changed on your side, we only need your approval and access to get started.',
  },
  chapters: buildChapters(),
};

function b(text, badge) { return { badge }; }
function buildChapters() {
  return [
    // CH 02
    { no: '02', title: 'Search Visibility Stats', sub: 'Current organic traffic, keywords and whether Google has the site in its index.',
      sections: [
        { num: '2.1', heading: 'Overall Site Stats', src: 'SEMrush', shot: { label: 'SEMrush > Domain Overview > stratasoundmusic.com', note: 'Database: US. Highlight Authority Score, Organic Traffic and Keywords with a red box.' },
          bullets: [{ kind: 'info', title: 'Current Observation', badge: 'INFO', text: 'Looking at the SEMrush report, the organic traffic, organic keywords and Authority Score for the website are all at zero. As the website is new and currently blocked from indexing, this is expected. We will take these numbers as the starting baseline for the campaign.' }] },
        { num: '2.2', heading: 'Google Index Check', src: 'site:stratasoundmusic.com', shot: { label: 'Google search: site:stratasoundmusic.com', note: 'Also add the same search on Bing, and a search for "StrataSound Music". Red box on "No results".' },
          bullets: [{ kind: 'crit', title: 'Current Observation', badge: 'CRITICAL', text: 'No pages of the website are indexed in Google. We also searched the brand name "StrataSound Music" and the website did not come up in the results. Google is showing other results for "Strata" (albums and Bandcamp artists) instead. The site is not indexed in Bing either, which also feeds ChatGPT search and Microsoft Copilot.' }] },
      ] },
    // CH 03
    { no: '03', title: 'Technical SEO Stats', sub: 'Can search engines find, crawl and index the website?',
      sections: [
        { num: '3.1', heading: 'Meta Robots Tag', src: 'Page Source', shot: { label: 'view-source:https://stratasoundmusic.com/', note: 'Red box on the meta robots noindex, nofollow line.' },
          bullets: [{ kind: 'crit', title: 'Current Observation', badge: 'CRITICAL', text: 'All 9 pages of the website have the meta robots tag set to noindex, nofollow. This tells Google and Bing not to show the pages in search results and not to follow the links on them. This is the main reason the website is not indexed.' }],
          willdo: { text: 'Remove the blocking setting from all pages, submit the website to Google and Bing, and request indexing for the key pages. This will be our first task after approval.' } },
        { num: '3.2', heading: 'Robots.txt', src: 'stratasoundmusic.com/robots.txt', shot: { label: 'stratasoundmusic.com/robots.txt' },
          bullets: [{ kind: 'info', title: 'Current Observation', badge: 'MEDIUM', text: 'Default WordPress robots.txt file is present on the site. It is not blocking any important pages or AI crawlers (GPTBot, PerplexityBot, ClaudeBot, Google-Extended), which is good. But the Sitemap line is missing. This will be updated by our team as part of the setup.' }] },
        { num: '3.3', heading: 'XML Sitemap', src: 'Browser', shot: { label: 'Browser: stratasoundmusic.com/sitemap_index.xml and /wp-sitemap.xml', note: 'Show the page not found / no sitemap result. Red box on the URL.' },
          bullets: [{ kind: 'crit', title: 'Current Observation', badge: 'CRITICAL', text: 'The website does not have an XML sitemap. WordPress switches off its default sitemap when the noindex option is on. Our team will create the sitemap and submit it to Google and Bing as part of the setup.' }] },
        { num: '3.4', heading: 'Response Codes & Links', src: 'Screaming Frog', shot: { label: 'Screaming Frog > Response Codes > All', note: 'Red box on Client Error (4xx) and Redirection (3xx) rows.' } },
        { num: '3.5', heading: 'Technical Checklist',
          table: { cols: [{ label: 'Check', width: '34%' }, { label: 'Status', align: 'c', width: '14%' }, { label: 'Finding' }], rows: [
            [{ text: 'Meta robots tag', bold: true }, { badge: 'FAIL', align: 'c' }, { text: 'noindex, nofollow on all 9 pages' }],
            [{ text: 'XML sitemap', bold: true }, { badge: 'FAIL', align: 'c' }, { text: 'Not found' }],
            [{ text: 'Robots.txt', bold: true }, { badge: 'PASS', align: 'c' }, { text: 'Present, sitemap line missing' }],
            [{ text: 'HTTPS / SSL', bold: true }, { badge: 'PASS', align: 'c' }, { text: 'Active on all pages' }],
            [{ text: 'Canonical tags', bold: true }, { badge: 'PASS', align: 'c' }, { text: 'Self-referencing, https non-www' }],
            [{ text: 'Broken links (4xx)', bold: true }, { badge: 'PASS', align: 'c' }, { text: 'None found' }],
            [{ text: 'www / http redirects', bold: true }, { badge: 'PENDING', align: 'c' }, { text: 'To confirm with hosting access' }],
            [{ text: 'Buttons linking to "#"', bold: true }, { badge: 'FAIL', align: 'c' }, { text: '9 buttons on the homepage lead nowhere' }],
          ] } },
      ] },
    // CH 04
    { no: '04', title: 'Page Performance & Mobile Usability', sub: 'How fast the website loads and how it works on mobile.',
      stats: [{ v: '4.03 MB', l: 'homepage size (target under 2 MB)' }, { v: '38', l: 'images on the homepage' }, { v: '16', l: 'HTML validation errors' }],
      sections: [
        { num: '4.1', heading: 'Page Performance: Mobile', src: 'Lighthouse', shot: { label: 'PageSpeed Insights > stratasoundmusic.com > Mobile', note: 'pagespeed.web.dev. Red box on Performance score, LCP and Speed Index.' } },
        { num: '4.2', heading: 'Page Performance: Desktop', src: 'Lighthouse', shot: { label: 'PageSpeed Insights > stratasoundmusic.com > Desktop', note: 'Red box on Performance score.' } },
        { num: '4.3', heading: 'Core Web Vitals', src: "Google's speed signals",
          table: { cols: [{ label: 'Metric' }, { label: 'What it measures' }, { label: 'Good target' }, { label: 'StrataSound' }], rows: [
            [{ text: 'LCP — Largest Contentful Paint', bold: true }, { text: 'How quickly the main content appears' }, { text: '2.5 s or less' }, { text: '____ s' }],
            [{ text: 'INP — Interaction to Next Paint', bold: true }, { text: 'How quickly the page reacts to a tap' }, { text: '200 ms or less' }, { text: '____ ms' }],
            [{ text: 'CLS — Cumulative Layout Shift', bold: true }, { text: 'Whether the layout jumps while loading' }, { text: '0.1 or less' }, { text: '____' }],
            [{ text: 'Performance Score', bold: true }, { text: 'Lighthouse lab test, 0 to 100' }, { text: '90+' }, { text: 'M: __ / D: __' }],
          ] } },
        { num: '4.4', heading: 'What Is Slowing the Site Down',
          table: { cols: [{ label: 'Finding' }, { label: 'Priority', align: 'c', width: '18%' }, { label: 'Impact on the website' }], rows: [
            [{ text: 'Heavy homepage (4.03 MB)', bold: true }, { badge: 'HIGH', align: 'c' }, { text: 'Slower loading, especially on mobile data' }],
            [{ text: 'Page builder overhead (Elementor 4.0.1)', bold: true }, { badge: 'MEDIUM', align: 'c' }, { text: 'Extra code loads on every page' }],
            [{ text: 'Google Fonts loaded externally', bold: true }, { badge: 'MEDIUM', align: 'c' }, { text: 'Adds extra requests before text appears' }],
            [{ text: 'Menu code repeated 4 times', bold: true }, { badge: 'MEDIUM', align: 'c' }, { text: 'Increases page size' }],
            [{ text: '16 HTML validation errors', bold: true }, { badge: 'MEDIUM', align: 'c' }, { text: 'Mostly builder markup, low impact on ranking' }],
          ],
          }, willdo: { text: 'Full speed optimisation of the website (images, code, fonts and caching) to bring the homepage under 2 MB and pass Core Web Vitals.' } },
        { num: '4.5', heading: 'Mobile Usability', src: 'Responsiveness', shot: { label: 'Homepage on mobile, tablet and desktop', note: 'Use a responsive / browser device mode.' },
          bullets: [{ kind: 'good', title: 'Current Observation', badge: 'GOOD', text: 'The website is mobile friendly and the layout adjusts well on mobile devices. We will re-test it on real iOS and Android devices after the speed work.' }] },
      ] },
    // CH 05
    { no: '05', title: 'On Page SEO Stats', sub: 'Titles, descriptions, headings, images, schema and social tags.',
      sections: [
        { num: '5.1', heading: 'Meta Title & Meta Description', src: 'Crawl of all 9 pages', shot: { label: 'Crawl table: URL, Title, Title Length, Meta Description, Meta Robots' },
          bullets: [{ kind: 'high', title: 'Current Observation', badge: 'HIGH', list: ['Missing Meta Description: 9 (all pages)', 'Titles have only the brand / page name, no keywords used', 'Brand name repeated in title: 2 (Privacy Policy, Terms of Use)', 'Meta Robots noindex: 9'] }] },
        { num: '5.2', heading: 'Title & Description Rewrite', src: 'Sample',
          table: { cols: [{ label: '' }, { label: 'Current' }, { label: 'Sample after optimisation' }], rows: [
            [{ text: 'Title', bold: true }, { text: 'Stratasound Music' }, { text: 'AI Music Generator: Create Songs From Anything | StrataSound' }],
            [{ text: 'Description', bold: true }, { text: '(missing)' }, { text: 'Turn ideas, words and moods into original music with StrataSound. Create, share and climb the leaderboard.' }],
          ] } },
        { num: '5.3', heading: 'Heading Tags', src: 'Homepage', shot: { label: 'Heading structure of the homepage (H1, H2, H3)' },
          bullets: [{ kind: 'high', title: 'Current Observation', badge: 'MEDIUM', text: 'Every page has one H1 tag, which is good. But on the homepage the same H2 "Where Music Meets Your Soul" is used twice, and placeholder names like "Music Name" and "Singer Name" are used as H3 tags. Songs, Singing and Contact Us pages have no H2 at all.' }],
          willdo: { text: 'Restructure the headings on all pages so each section has a clear, keyword-focused heading, and remove placeholder headings.' } },
        { num: '5.4', heading: 'Images', src: 'Screaming Frog', shot: { label: 'Screaming Frog > Images', note: 'Red box on Missing Alt Text and Over 100 KB rows.' },
          bullets: [{ kind: 'high', title: 'Current Observation', badge: 'HIGH', list: ['Images on homepage: 38', 'Alt text: not found on the images we checked', 'Images over 100 KB: ____'] }] },
        { num: '5.5', heading: 'Schema Markup', src: 'Rich Results Test', shot: { label: 'Google Rich Results Test > stratasoundmusic.com', note: 'Red box on "No items detected".' },
          table: { cols: [{ label: 'Schema type' }, { label: 'Status', align: 'c', width: '16%' }, { label: 'Why it matters' }], rows: [
            [{ text: 'Organization', bold: true }, { badge: 'MISSING', align: 'c' }, { text: 'Name, logo, contact and links to the 5 social profiles; helps Google show a brand panel' }],
            [{ text: 'SoftwareApplication', bold: true }, { badge: 'MISSING', align: 'c' }, { text: 'App name, category (Music), platforms and rating once the app is live' }],
            [{ text: 'WebSite', bold: true }, { badge: 'MISSING', align: 'c' }, { text: 'Confirms the site name shown in Google results' }],
            [{ text: 'BreadcrumbList', bold: true }, { badge: 'MISSING', align: 'c' }, { text: 'Cleaner page paths in search results' }],
            [{ text: 'FAQPage', bold: true }, { badge: 'OPTIONAL', align: 'c' }, { text: 'No longer shown as rich results (since May 2026) but still read by Google and AI tools' }],
          ], }, willdo: { text: 'Add the required schema markup across the website so Google and AI tools clearly understand the brand, the app and its social profiles.' } },
        { num: '5.6', heading: 'Social Tags', src: 'Open Graph', shot: { label: 'OpenGraph preview of stratasoundmusic.com', note: 'Use opengraph.xyz or a WhatsApp / Facebook share preview.' },
          bullets: [{ kind: 'high', title: 'Current Observation', badge: 'MEDIUM', text: 'No Open Graph or Twitter card tags were found on any page. When the website link is shared on WhatsApp, Facebook or Discord, it will not show a proper preview image and title. Our team will add social tags and a branded share image to all pages.' }] },
        { num: '5.7', heading: 'On Page SEO Final Verdict',
          willdo: { list: ['Remove the indexing block and submit the XML sitemap.', 'Keyword research and keyword mapping for each page.', 'New meta titles and descriptions for all pages.', 'Heading structure fixes and alt text for all images.', 'Schema markup and social (Open Graph) tags.'] } },
      ] },
    // CH 06
    { no: '06', title: 'Content Quality & Trust', sub: 'Google rewards Experience, Expertise, Authority and Trust (E-E-A-T). Visitors judge the same things.',
      sections: [
        { num: '6.1', heading: 'Dummy Text', src: 'Homepage', shot: { label: 'Homepage text with dummy / lorem ipsum highlighted' },
          bullets: [{ kind: 'crit', title: 'Current Observation', badge: 'CRITICAL', text: 'Dummy text "It is a long established fact that a reader will be distracted..." is still live on the homepage (4 times) and on the Leaderboard page, along with sample names like "Music Name" and "Singer Name". Google can treat these pages as low quality, and it does not look good to visitors either.' }] },
        { num: '6.2', heading: 'Testimonials', src: 'Homepage', shot: { label: 'Testimonials section, stratasoundmusic.com homepage' },
          bullets: [{ kind: 'high', title: 'Current Observation', badge: 'HIGH', text: 'Two testimonials have exactly the same text with different names, and the heading has a small grammar mistake ("Customer Say\'s"). These look like sample testimonials, which can hurt trust. Real user feedback will build much more trust once the app is live.' }] },
        { num: '6.3', heading: 'Word Count', src: 'All main pages',
          table: { cols: [{ label: 'Page' }, { label: 'Approx. words' }, { label: 'Remarks' }], rows: [
            [{ text: 'Singing', bold: true }, { text: '15' }, { text: 'Only one line of text and an image' }],
            [{ text: 'Contact Us', bold: true }, { text: '35' }, { text: 'No address, form needs JavaScript' }],
            [{ text: 'Leaderboard', bold: true }, { text: '70' }, { text: 'Includes dummy paragraph' }],
            [{ text: 'Songs', bold: true }, { text: '100' }, { text: '"Coming Soon" placeholders' }],
            [{ text: 'About Us', bold: true }, { text: '190' }, { text: 'Last sentence is cut off' }],
            [{ text: 'Home', bold: true }, { text: '500' }, { text: 'Includes dummy text' }],
          ] } },
        { num: '6.4', heading: 'Trust Signals (E-E-A-T)',
          table: { cols: [{ label: 'Check' }, { label: 'Status', align: 'c', width: '16%' }, { label: 'Finding' }], rows: [
            [{ text: 'About / company information', bold: true }, { badge: 'MEDIUM', align: 'c' }, { text: 'Mission is clear, but no founders, team, company name or location' }],
            [{ text: 'Contact details', bold: true }, { badge: 'GOOD', align: 'c' }, { text: 'Phone and support email shown site-wide' }],
            [{ text: 'Legal pages', bold: true }, { badge: 'GOOD', align: 'c' }, { text: 'Privacy, Terms and Content Policy published with dates' }],
            [{ text: 'Brand name consistency', bold: true }, { badge: 'MEDIUM', align: 'c' }, { text: 'Written as both "StrataSound" and "Stratasound"' }],
            [{ text: 'Blog / helpful guides', bold: true }, { badge: 'HIGH', align: 'c' }, { text: 'No blog yet; guides are how competitors win most search and AI traffic' }],
            [{ text: 'Genuine reviews', bold: true }, { badge: 'HIGH', align: 'c' }, { text: 'Testimonials look like samples' }],
          ], }, willdo: { text: 'Our content team will write SEO-friendly content for every main page (300+ words each), replace the dummy text, and prepare a team / About section. You only need to review and approve the content, and share real tracks or user feedback when available.' } },
      ] },
    // CH 07
    { no: '07', title: 'Site Architecture', sub: 'Menu, URL structure and how pages link to each other.',
      sections: [
        { num: '7.1', heading: 'Website Architecture Analysis',
          table: { cols: [{ label: 'Element' }, { label: 'stratasoundmusic.com', align: 'c', width: '26%' }], rows: [
            [{ text: 'Does the website have a proper menu in header?' }, { badge: 'PASS', align: 'c' }],
            [{ text: 'Are the URLs short and SEO friendly?' }, { badge: 'PASS', align: 'c' }],
            [{ text: 'Does the site have an XML sitemap and optimized robots.txt?' }, { badge: 'FAIL', align: 'c' }],
            [{ text: 'Does the site have an optimized footer?' }, { badge: 'PASS', align: 'c' }],
            [{ text: 'Does it have a blog?' }, { badge: 'FAIL', align: 'c' }],
            [{ text: 'Does it have feature / use-case landing pages?' }, { badge: 'FAIL', align: 'c' }],
            [{ text: 'Are the pages interlinked properly?' }, { badge: 'FAIL', align: 'c' }],
            [{ text: 'Are the app store buttons linked to live listings?' }, { badge: 'FAIL', align: 'c' }],
            [{ text: 'Is a contact page with contact details available?' }, { badge: 'PASS', align: 'c' }],
          ],
          }, bullets: [{ kind: 'high', title: 'Current Observation', badge: 'MEDIUM', text: 'The basic structure of the website is clean with short URLs and a simple menu. But there is no blog or feature pages to target search terms, and many buttons (Read More, Listen now, View All, app store badges) are linked to "#", so pages are not interlinked properly.' }] },
        { num: '7.2', heading: 'Proposed Site Structure', src: 'For approval',
          cols: { leftTitle: 'Current pages', left: ['Home', 'Songs', 'About Us', 'Leaderboard', 'Singing', 'Contact Us', 'Privacy / Terms / Content Policy'], rightTitle: 'Pages we propose to add', right: ['Use cases: music for creators, events and weddings', 'Comparison: StrataSound vs Suno, vs Udio', 'Blog with how-to guides', 'FAQ page', 'App download page (Play Store / App Store)'] } },
      ] },
    // CH 08
    { no: '08', title: 'Off Page Stats', sub: 'Who links to the website today, and how strong those links are.',
      stats: [{ v: '24', l: 'total backlinks' }, { v: '0', l: 'quality referring domains' }, { v: '100%', l: 'nofollow links' }, { v: '0', l: 'Authority Score of linking pages' }],
      sections: [
        { num: '8.1', heading: 'Backlink Status', src: 'SEMrush', shot: { label: 'SEMrush backlink table: Source URL, Anchor, Authority Score, Follow' },
          bullets: [{ kind: 'high', title: 'Current Observation', badge: 'HIGH', text: 'All 24 links are from automated listing / domain stats sites which pick up new domains on their own. They are not harmful, so no disavow is needed, but they also don\'t pass any value. Link building needs to start from scratch.' }] },
        { num: '8.2', heading: 'Website Authority', src: 'DA, PA, Spam Score', shot: { label: 'Website authority checker > stratasoundmusic.com', note: 'Moz / Website SEO Checker. Red box on DA, PA and Spam Score.' } },
        { num: '8.3', heading: 'Link Building Plan', src: 'For approval',
          table: { cols: [{ label: 'Link source type' }, { label: 'What our team will do' }, { label: 'Priority', align: 'c', width: '16%' }], rows: [
            [{ text: 'AI tool directories', bold: true }, { text: 'Submit and list StrataSound on relevant AI and music tool directories' }, { badge: 'HIGH', align: 'c' }],
            [{ text: 'App listings', bold: true }, { text: 'Connect the website with the app store listings at launch' }, { badge: 'HIGH', align: 'c' }],
            [{ text: 'Comparison articles', bold: true }, { text: 'Outreach to get StrataSound included in "best AI music app" articles' }, { badge: 'HIGH', align: 'c' }],
            [{ text: 'Music & creator media', bold: true }, { text: 'Launch story and outreach to music-tech and creator publications' }, { badge: 'MEDIUM', align: 'c' }],
            [{ text: 'Communities', bold: true }, { text: 'Brand presence in relevant music and creator communities' }, { badge: 'MEDIUM', align: 'c' }],
          ] } },
      ] },
    // CH 09
    { no: '09', title: 'Competitor Overview', sub: 'How the AI music market looks in search.',
      sections: [
        { num: '9.1', heading: 'Competitor Traffic', src: 'SEMrush, August 2026', shot: { label: 'Estimated monthly traffic chart — suno.com, udio.com, mubert.com, soundraw.io, boomy.com vs stratasoundmusic.com' },
          bullets: [{ kind: 'info', title: 'Current Observation', badge: 'INFO', text: 'Suno is the market leader by a big margin (about 60 times Udio\'s traffic). Mubert, Soundraw and Boomy get much smaller traffic. Competing with Suno on broad terms like "AI music generator" will take time.' }] },
        { num: '9.2', heading: 'Where StrataSound Can Win',
          table: { cols: [{ label: 'Competitor strength' }, { label: "StrataSound's opening" }], rows: [
            [{ text: 'Suno and Udio own broad terms like "AI song generator"' }, { text: 'Target niche searches: "sing over AI beats", "AI music leaderboard", "Suno alternative with community"' }],
            [{ text: 'Soundraw, Mubert and Loudly focus on royalty-free background music' }, { text: 'Use cases from your own testimonials: event music, YouTube / TikTok tracks, wedding music' }],
            [{ text: 'Competitors publish guides and comparison pages' }, { text: 'Build "StrataSound vs Suno / Udio" pages and how-to guides' }],
            [{ text: 'Listed across AI directories and app stores' }, { text: 'Directory and app store listings in Month 1' }],
          ] } },
      ] },
    // CH 10
    { no: '10', title: 'Keyword Opportunity Map', sub: 'The main search phrase each page should focus on.',
      sections: [
        { num: '10.1', heading: 'Proposed Keyword Targets', src: 'For approval',
          table: { cols: [{ label: 'Page' }, { label: 'Primary keyword' }, { label: 'Supporting keywords' }, { label: 'Difficulty', align: 'c', width: '14%' }], rows: [
            [{ text: 'Home', bold: true }, { text: 'AI music generator app' }, { text: 'create music from anything, AI song maker' }, { badge: 'MEDIUM', align: 'c' }],
            [{ text: 'Singing', bold: true }, { text: 'sing over AI music' }, { text: 'AI karaoke app, record vocals on AI beats' }, { badge: 'MEDIUM', align: 'c' }],
            [{ text: 'Leaderboard', bold: true }, { text: 'music creator leaderboard' }, { text: 'AI music contest, upload songs and get discovered' }, { badge: 'GOOD', align: 'c' }],
            [{ text: 'Songs', bold: true }, { text: 'AI generated songs' }, { text: 'new AI music, trending AI songs' }, { badge: 'MEDIUM', align: 'c' }],
            [{ text: 'About', bold: true }, { text: 'StrataSound Music' }, { text: 'StrataSound app, StrataSound AI' }, { badge: 'GOOD', align: 'c' }],
            [{ text: 'New: Use cases', bold: true }, { text: 'AI background music for YouTube' }, { text: 'royalty-free AI music, AI wedding song' }, { badge: 'HIGH', align: 'c' }],
            [{ text: 'New: Comparison', bold: true }, { text: 'Suno alternative' }, { text: 'Suno vs Udio vs StrataSound' }, { badge: 'HIGH', align: 'c' }],
            [{ text: 'New: Blog', bold: true }, { text: 'how to make a song with AI' }, { text: 'AI music prompts, is AI music copyright free' }, { badge: 'MEDIUM', align: 'c' }],
          ] } },
        { num: '10.2', heading: 'Keyword Research', src: 'SEMrush Keyword Magic Tool', shot: { label: 'SEMrush > Keyword Magic Tool > "AI music generator"', note: 'Red box on volume and KD% for the main keywords.' },
          bullets: [{ kind: 'info', title: 'Proposed Content Plan (on your approval)', list: ['Expand the 4 core pages (Home, Singing, Leaderboard, Songs) with keyword-focused content.', 'Create 3 use-case pages: creators, events and weddings, singing over AI tracks.', 'Create 2 comparison pages: StrataSound vs Suno, and StrataSound vs Udio.', 'Publish 4 blog guides a month.'] }] },
      ] },
    // CH 11
    { no: '11', title: 'AI Search Visibility', sub: 'ChatGPT, Perplexity, Gemini and Google AI Overviews.',
      sections: [
        { num: '11.1', heading: 'AI Answers for "best AI music generator"', src: 'ChatGPT / Perplexity', shot: { label: 'ChatGPT or Perplexity answer for "best AI music generator apps"', note: 'Red box on the list of tools mentioned.' },
          bullets: [{ kind: 'high', title: 'Current Observation', badge: 'HIGH', text: 'More people now ask ChatGPT, Perplexity, Gemini and Google AI Overviews for app suggestions. These tools mostly pick brands from "best of" articles and well-known websites. We checked current "best AI music generator" and "Suno alternatives" articles. The tools mentioned are Udio, Stable Audio, AIVA, Mureka, Soundful, Loudly, Boomy and Sonauto. StrataSound is not mentioned yet.' }] },
        { num: '11.2', heading: 'AI Readiness Checklist',
          table: { cols: [{ label: 'Check' }, { label: 'Status', align: 'c', width: '14%' }, { label: 'Finding' }], rows: [
            [{ text: 'Brand found in web search', bold: true }, { badge: 'FAIL', align: 'c' }, { text: 'Search shows unrelated "Strata" results' }],
            [{ text: 'Indexed in Google and Bing', bold: true }, { badge: 'FAIL', align: 'c' }, { text: 'Blocked by noindex' }],
            [{ text: 'Mentioned in AI-tool roundups', bold: true }, { badge: 'FAIL', align: 'c' }, { text: 'Not listed in articles we reviewed' }],
            [{ text: 'AI crawlers allowed', bold: true }, { badge: 'PASS', align: 'c' }, { text: 'Not blocked in robots.txt' }],
            [{ text: 'Answer-friendly content (FAQs, guides)', bold: true }, { badge: 'FAIL', align: 'c' }, { text: 'No FAQ or how-to content yet' }],
            [{ text: 'Organization schema with social links', bold: true }, { badge: 'FAIL', align: 'c' }, { text: 'Missing' }],
            [{ text: 'llms.txt file', bold: true }, { badge: 'OPTIONAL', align: 'c' }, { text: 'Experimental, low effort extra' }],
          ], }, willdo: { text: 'Get the website indexed, add answer-friendly FAQ content and schema, and work on listings and article mentions so AI tools start recommending StrataSound.' } },
        { num: '11.3', heading: 'Monthly AI Visibility Test',
          bullets: [{ kind: 'info', title: 'Baseline: 0 of 5 prompts mention StrataSound', badge: 'INFO', list: ['"What is the best app to create music from anything with AI?"', '"Which AI music apps let me sing over the tracks?"', '"What are good alternatives to Suno?"', '"What is StrataSound Music?"', '"Best AI music app for content creators and TikTok"'] }] },
      ] },
    // CH 12
    { no: '12', title: 'Tracking & Social Profiles', sub: 'Analytics setup and social media presence.',
      sections: [
        { num: '12.1', heading: 'Tracking Setup',
          table: { cols: [{ label: 'Element' }, { label: 'Status', align: 'c', width: '14%' }, { label: 'Remarks' }], rows: [
            [{ text: 'Google Analytics 4', bold: true }, { badge: 'FAIL', align: 'c' }, { text: 'Not found on the website' }],
            [{ text: 'Google Search Console', bold: true }, { badge: 'FAIL', align: 'c' }, { text: 'Not found' }],
            [{ text: 'Bing Webmaster Tools', bold: true }, { badge: 'FAIL', align: 'c' }, { text: 'Not found' }],
            [{ text: 'Google Tag Manager', bold: true }, { badge: 'FAIL', align: 'c' }, { text: 'Not found' }],
            [{ text: 'Meta / TikTok pixels', bold: true }, { badge: 'FAIL', align: 'c' }, { text: 'Not found (needed if paid social is planned)' }],
            [{ text: 'Microsoft Clarity', bold: true }, { badge: 'OPTIONAL', align: 'c' }, { text: 'Not found (free heatmaps)' }],
            [{ text: 'Cookie consent banner', bold: true }, { badge: 'FAIL', align: 'c' }, { text: 'Not found' }],
          ] } },
        { num: '12.2', heading: 'Social Profiles',
          table: { cols: [{ label: 'Profile' }, { label: 'Status', align: 'c', width: '14%' }, { label: 'Remarks' }], rows: [
            [{ text: 'YouTube (@StrataSoundMusic)', bold: true }, { badge: 'PASS', align: 'c' }, { text: 'Channel created, no videos yet' }],
            [{ text: 'Facebook (StrataSound Music)', bold: true }, { badge: 'PASS', align: 'c' }, { text: 'Linked from footer' }],
            [{ text: 'X / Twitter (@stratasoundllc)', bold: true }, { badge: 'PASS', align: 'c' }, { text: 'Handle is different from brand name' }],
            [{ text: 'TikTok (@stratasoundmusic)', bold: true }, { badge: 'PASS', align: 'c' }, { text: 'Linked from footer' }],
            [{ text: 'Discord', bold: true }, { badge: 'FAIL', align: 'c' }, { text: 'Link opens Discord login, not an invite' }],
            [{ text: 'Google Play / App Store', bold: true }, { badge: 'FAIL', align: 'c' }, { text: 'Badges linked to "#"' }],
          ],
          }, bullets: [{ kind: 'high', title: 'Current Observation', badge: 'HIGH', text: 'No tracking is set up on the website, so we can\'t measure visitors or sign-ups yet. Social profiles are created and linked, but need regular content, and the Discord and app store links are not working yet.' }],
          willdo: { text: 'Set up GA4, Search Console, Bing Webmaster Tools and Tag Manager with conversion tracking, add a cookie banner, and fix the Discord and app store links.' } },
      ] },
    // CH 13
    { no: '13', title: 'Baseline KPIs', sub: 'The starting numbers on 9 October 2026. Every monthly report will update this table.',
      sections: [
        { num: '13.1', heading: 'KPI Tracker',
          table: { cols: [{ label: 'KPI' }, { label: 'Baseline Oct 2026' }, { label: 'Month 1' }, { label: 'Month 3' }, { label: 'Month 6' }], rows: [
            [{ text: 'SEO health score (Qtonix)', bold: true }, { text: '21 / 100' }, { text: '' }, { text: '' }, { text: '' }],
            [{ text: 'Pages indexed in Google', bold: true }, { text: '0' }, { text: '' }, { text: '' }, { text: '' }],
            [{ text: 'Pages indexed in Bing', bold: true }, { text: '0' }, { text: '' }, { text: '' }, { text: '' }],
            [{ text: 'Keywords ranking (top 100)', bold: true }, { text: '0' }, { text: '' }, { text: '' }, { text: '' }],
            [{ text: 'Keywords in top 10', bold: true }, { text: '0' }, { text: '' }, { text: '' }, { text: '' }],
            [{ text: 'Organic visits / month', bold: true }, { text: '0' }, { text: '' }, { text: '' }, { text: '' }],
            [{ text: 'Quality referring domains', bold: true }, { text: '0' }, { text: '' }, { text: '' }, { text: '' }],
            [{ text: 'Total backlinks found', bold: true }, { text: '24' }, { text: '' }, { text: '' }, { text: '' }],
            [{ text: 'Pages with meta description', bold: true }, { text: '0 / 9' }, { text: '' }, { text: '' }, { text: '' }],
            [{ text: 'Pages with schema markup', bold: true }, { text: '0 / 9' }, { text: '' }, { text: '' }, { text: '' }],
            [{ text: 'Homepage size', bold: true }, { text: '4.03 MB' }, { text: '' }, { text: '' }, { text: '' }],
            [{ text: 'AI prompts mentioning StrataSound', bold: true }, { text: '0 / 5' }, { text: '' }, { text: '' }, { text: '' }],
          ], }, bullets: [{ kind: 'info', title: 'What to expect, honestly', list: ['Month 1 is about fixing foundations: indexing, tracking, titles and schema.', 'Indexed pages and first brand rankings usually follow within 2 to 6 weeks of removing noindex.', 'Competitive keywords like "AI music generator" take longer, which is why we start with niche searches where StrataSound can win sooner.'] }] },
      ] },
    // CH 14
    { no: '14', title: 'Action Plan & Approval', sub: 'What our team will do after your approval, and when.',
      sections: [
        { num: '14.1', heading: 'Week by Week Plan',
          weeks: [
            { label: 'Day 0', sub: 'Approval', who: 'StrataSound', items: ['Review this report and approve the plan', 'Share WordPress admin and Google account access'] },
            { label: 'Week 1', sub: 'Foundations', who: 'Qtonix', items: ['Remove noindex, set up XML sitemap', 'Google Search Console, Bing Webmaster Tools, GA4', 'New meta titles & descriptions for all pages', 'Schema markup and Open Graph tags', 'Image compression, caching, speed fixes'] },
            { label: 'Week 2', sub: 'Research', who: 'Qtonix', items: ['Keyword research and keyword mapping', 'Fix "#" links, app store badges and Discord invite'] },
            { label: 'Week 3', sub: 'Content & listings', who: 'Qtonix', items: ['Rewrite main pages and replace dummy text', 'AI tool directory and app listings'] },
            { label: 'Week 4', sub: 'Grow & report', who: 'Qtonix', items: ['First blog posts and comparison page', 'AI search visibility check', 'Monthly report and review call'] },
          ] },
        { num: '14.2', heading: 'What We Need From You',
          cols: { leftTitle: 'Approval', left: ['Approval of the items listed below', 'Approval of new page content before it goes live'], rightTitle: 'Access', right: ['WordPress admin login', 'Hosting / DNS access', 'Any existing Google Analytics or Search Console accounts'] } },
        { num: '14.3', heading: 'Items for Your Approval',
          table: { cols: [{ label: '#', width: '6%' }, { label: 'Item' }, { label: 'Priority', align: 'c', width: '16%' }, { label: 'Approve', align: 'c', width: '12%' }], rows: [
            [{ text: '1' }, { text: 'Remove indexing block, create and submit XML sitemap' }, { badge: 'CRITICAL', align: 'c' }, { text: '☐', align: 'c' }],
            [{ text: '2' }, { text: 'Set up GA4, Search Console, Bing Webmaster Tools, Tag Manager' }, { badge: 'HIGH', align: 'c' }, { text: '☐', align: 'c' }],
            [{ text: '3' }, { text: 'Rewrite titles and meta descriptions for all pages' }, { badge: 'HIGH', align: 'c' }, { text: '☐', align: 'c' }],
            [{ text: '4' }, { text: 'Fix headings, add image alt text, schema and social tags' }, { badge: 'HIGH', align: 'c' }, { text: '☐', align: 'c' }],
            [{ text: '5' }, { text: 'Speed optimisation (images, code, caching)' }, { badge: 'HIGH', align: 'c' }, { text: '☐', align: 'c' }],
            [{ text: '6' }, { text: 'Replace dummy text and write SEO content for main pages' }, { badge: 'HIGH', align: 'c' }, { text: '☐', align: 'c' }],
            [{ text: '7' }, { text: 'Fix "#" links, app store buttons and Discord link' }, { badge: 'MEDIUM', align: 'c' }, { text: '☐', align: 'c' }],
            [{ text: '8' }, { text: 'Create use-case and comparison pages, start blog' }, { badge: 'MEDIUM', align: 'c' }, { text: '☐', align: 'c' }],
            [{ text: '9' }, { text: 'Link building and AI search visibility work' }, { badge: 'MEDIUM', align: 'c' }, { text: '☐', align: 'c' }],
          ] } },
      ] },
    // APPENDIX A
    { no: 'A', title: 'Method & Glossary', sub: 'How this audit was done and what the SEO terms mean.',
      sections: [
        { num: 'A.1', heading: 'How This Audit Was Done',
          table: { cols: [{ label: 'Area' }, { label: 'Source and date' }], rows: [
            [{ text: 'Page checks (all 9 pages)', bold: true }, { text: 'Manual review of live page code and content, 9 Oct 2026' }],
            [{ text: 'Robots.txt, sitemap, canonical, meta robots', bold: true }, { text: 'Direct checks of the live site, 9 Oct 2026' }],
            [{ text: 'Backlinks', bold: true }, { text: 'SEMrush backlink report, 8 Oct 2026' }],
            [{ text: 'HTML validation, page size, mobile check', bold: true }, { text: 'Qtonix team tests, 8 Oct 2026' }],
            [{ text: 'Competitor traffic', bold: true }, { text: 'SEMrush website overview, August 2026 data' }],
            [{ text: 'Search & AI visibility', bold: true }, { text: 'Brand search and review of "AI music generator" roundups, Oct 2026' }],
          ] } },
        { num: 'A.2', heading: 'Glossary',
          table: { cols: [{ label: 'Term' }, { label: 'Plain meaning' }], rows: [
            [{ text: 'Indexing', bold: true }, { text: 'Google saving a page so it can appear in search results' }],
            [{ text: 'noindex', bold: true }, { text: 'A tag asking search engines not to show a page in results' }],
            [{ text: 'XML sitemap', bold: true }, { text: 'A file listing all pages so search engines find them quickly' }],
            [{ text: 'Canonical tag', bold: true }, { text: 'Tells Google which URL is the main version of a page' }],
            [{ text: 'Meta description', bold: true }, { text: 'The short summary shown under the title in Google' }],
            [{ text: 'Backlink / referring domain', bold: true }, { text: 'A link from another website / number of unique sites linking to you' }],
            [{ text: 'nofollow', bold: true }, { text: 'A link marked to pass no ranking value' }],
            [{ text: 'Authority Score', bold: true }, { text: "SEMrush's 0 to 100 rating of a site's overall strength" }],
            [{ text: 'Core Web Vitals', bold: true }, { text: "Google's speed and stability measurements: LCP, INP and CLS" }],
            [{ text: 'Schema markup', bold: true }, { text: 'Code that describes a business or page for search engines' }],
            [{ text: 'E-E-A-T', bold: true }, { text: 'Experience, Expertise, Authority, Trust: how Google judges quality' }],
            [{ text: 'GEO / AI SEO', bold: true }, { text: 'Improving how often AI tools mention and recommend a brand' }],
          ] } },
      ] },
  ];
}

const tplSrc = fs.readFileSync(path.join(__dirname, '../templates/preSeoReport.hbs'), 'utf8');
const html = Handlebars.compile(tplSrc)(data);
const outDir = '/mnt/user-data/outputs';
fs.mkdirSync(outDir, { recursive: true });
const htmlPath = path.join(outDir, 'preseo-sample.html');
fs.writeFileSync(htmlPath, html, 'utf8');
const pdfPath = path.join(outDir, 'qtonix-preseo-report-sample.pdf');
execFileSync('python3', ['-m', 'weasyprint', '-e', 'utf-8', '-u', outDir, htmlPath, pdfPath], { timeout: 120000 });
console.log('PDF:', pdfPath);
