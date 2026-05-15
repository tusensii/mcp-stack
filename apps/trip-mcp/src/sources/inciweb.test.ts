import { describe, it, expect } from "vitest";
import * as inciweb from "./inciweb.js";

describe("inciweb source", () => {
  it("module loads", () => {
    void inciweb.getInciwebFeed;
    void inciweb.parseInciwebFeed;
  });

  it("parseInciwebFeed extracts items from RSS", () => {
    const xml = `<?xml version="1.0"?><rss><channel>
      <item>
        <title>Foo Fire</title>
        <link>https://example.com/foo</link>
        <pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate>
        <description><![CDATA[Burning in Washington]]></description>
      </item>
      <item>
        <title>Bar Fire</title>
        <link>https://example.com/bar</link>
        <pubDate>Tue, 02 Jan 2024 00:00:00 GMT</pubDate>
        <description>Texas wildfire</description>
      </item>
    </channel></rss>`;
    const items = inciweb.parseInciwebFeed(xml);
    expect(items).toHaveLength(2);
    expect(items[0]?.title).toBe("Foo Fire");
    expect(items[0]?.description).toBe("Burning in Washington");
    expect(items[1]?.link).toBe("https://example.com/bar");
  });
});
