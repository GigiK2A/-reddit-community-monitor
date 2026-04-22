import { Actor } from 'apify';
import { PlaywrightCrawler } from 'crawlee';

await Actor.init();

const input = await Actor.getInput() || {};

const {
    subreddits = ['ClaudeAI', 'ClaudeCode', 'claudeaiprojects', 'ArtificialInteligence', 'vibecoding'],
    sort = 'new',
    maxPostsPerSubreddit = 10,
    useApifyProxy = true,
    apifyProxyGroups = ['RESIDENTIAL'],
} = input;

const startUrls = subreddits.map((subreddit) => ({
    url: `https://www.reddit.com/r/${subreddit}/${sort === 'top' ? 'top/?t=day' : sort}/`,
    userData: { subreddit },
}));

const crawler = new PlaywrightCrawler({
    requestHandlerTimeoutSecs: 90,
    maxRequestsPerCrawl: startUrls.length,
    headless: true,
    proxyConfiguration: await Actor.createProxyConfiguration(
        useApifyProxy
            ? { useApifyProxy: true, apifyProxyGroups }
            : undefined
    ),
    async requestHandler({ page, request, log }) {
        const { subreddit } = request.userData;

        await page.waitForLoadState('domcontentloaded');
        await page.waitForTimeout(3000);

        const posts = await page.$$eval(
            'article, shreddit-post, div[data-testid="post-container"]',
            (els, subreddit) => {
                const clean = (v) => (v || '').replace(/\s+/g, ' ').trim();

                const out = [];

                for (const el of els) {
                    const titleEl =
                        el.querySelector('h3') ||
                        el.querySelector('[slot="title"]') ||
                        el.querySelector('a[data-testid="post-title"]');

                    const title = clean(titleEl?.textContent);
                    if (!title) continue;

                    const links = [...el.querySelectorAll('a[href]')].map((a) => a.href).filter(Boolean);
                    const permalink =
                        links.find((x) => /reddit\.com\/r\/.+\/comments\//i.test(x)) || '';

                    const externalUrl =
                        links.find((x) => !/reddit\.com/i.test(x)) || '';

                    const textEl =
                        el.querySelector('[slot="text-body"]') ||
                        el.querySelector('[data-click-id="text"]') ||
                        el.querySelector('p');

                    const text = clean(textEl?.textContent);

                    const commentsEl =
                        [...el.querySelectorAll('a, span, div')].find((n) =>
                            /comment/i.test(n.textContent || '')
                        );
                    const commentsText = clean(commentsEl?.textContent || '');

                    const scoreEl =
                        [...el.querySelectorAll('span, div')].find((n) =>
                            /(upvote|points|point)/i.test(n.textContent || '')
                        );
                    const scoreText = clean(scoreEl?.textContent || '');

                    const lower = `${title} ${text} ${externalUrl} ${permalink}`.toLowerCase();

                    const hasRepo = /(github\.com|gitlab\.com|huggingface\.co|replicate\.com|vercel\.app|netlify\.app)/i.test(lower);
                    const hasDemo = /(demo|preview|live|launch|screenshot|video|repo|github)/i.test(lower);

                    out.push({
                        subreddit,
                        title,
                        text,
                        permalink,
                        externalUrl,
                        url: externalUrl || permalink,
                        commentsText,
                        scoreText,
                        community_verified: hasRepo || hasDemo,
                        proof_found: hasRepo ? 'repo' : hasDemo ? 'demo_or_screenshot' : 'none',
                    });
                }

                return out;
            },
            subreddit
        );

        const unique = [];
        const seen = new Set();

        for (const post of posts) {
            const key = `${post.title.toLowerCase()}|${post.url.toLowerCase()}`;
            if (seen.has(key)) continue;
            seen.add(key);
            unique.push(post);
            if (unique.length >= maxPostsPerSubreddit) break;
        }

        log.info(`Scraped ${unique.length} posts from r/${subreddit}`);
        await Actor.pushData(unique);
    },
});

await crawler.run(startUrls);
await Actor.exit();