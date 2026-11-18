import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { type Browser, chromium } from 'playwright-core';

import { APP_ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';

/**
 * HTML → PDF with headless Chromium (ADR 0012). JavaScript is disabled and all
 * network requests are blocked: templates are self-contained and untrusted
 * text can never fetch or execute anything.
 */
@Injectable()
export class PdfRenderer implements OnModuleDestroy {
  private readonly logger = new Logger(PdfRenderer.name);
  private browser: Promise<Browser> | null = null;

  constructor(@Inject(APP_ENV) private readonly env: Env) {}

  private getBrowser(): Promise<Browser> {
    this.browser ??= chromium
      .launch({
        headless: true,
        ...(this.env.PDF_CHROMIUM_EXECUTABLE
          ? { executablePath: this.env.PDF_CHROMIUM_EXECUTABLE }
          : {}),
      })
      .catch((error: unknown) => {
        this.browser = null;
        this.logger.error(
          'Chromium could not be started; run "bunx playwright-core install chromium"',
        );
        throw error;
      });
    return this.browser;
  }

  async render(html: string): Promise<Buffer> {
    const browser = await this.getBrowser();
    const context = await browser.newContext({ javaScriptEnabled: false, offline: true });
    try {
      const page = await context.newPage();
      await page.route('**/*', (route) => route.abort());
      await page.setContent(html, { waitUntil: 'load' });
      await page.emulateMedia({ media: 'print' });
      return await page.pdf({ preferCSSPageSize: true, printBackground: false });
    } finally {
      await context.close();
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.browser) {
      const browser = await this.browser.catch(() => null);
      await browser?.close();
    }
  }
}
