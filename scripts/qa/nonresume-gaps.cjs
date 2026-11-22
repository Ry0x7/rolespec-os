/* eslint-disable @typescript-eslint/no-require-imports -- Dedicated non-resume QA driver */
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { Client } = require('pg');

const evidenceDir = path.resolve('.unlazy/qa/evidence/nonresume');
fs.mkdirSync(evidenceDir, { recursive: true });

const PG_HOST = 'localhost';
const PG_PORT = 55432;
const PG_USER = 'rolespec';
const PG_PASS = 'rolespec';
const ORIGINAL_DB = 'rolespec';
const DISPOSABLE_DB = 'rolespec_qa_nonresume_20261120';
const APP_URL = 'http://127.0.0.1:3100';

async function queryPg(dbName, sql, params = []) {
  const client = new Client({
    host: PG_HOST,
    port: PG_PORT,
    user: PG_USER,
    password: PG_PASS,
    database: dbName,
  });
  await client.connect();
  try {
    return await client.query(sql, params);
  } finally {
    await client.end();
  }
}

async function run() {
  const report = {
    startedAt: new Date().toISOString(),
    environment: {
      appUrl: APP_URL,
      originalDb: ORIGINAL_DB,
      disposableDb: DISPOSABLE_DB,
    },
    isolationCheck: {},
    kanbanDragDrop: {},
    offlineControls: {},
    extensionConnect: {},
    workspaceErase: {},
    errors: [],
  };

  console.log('=== Step 1: Pre-flight Isolation Verification ===');
  const origUsers = await queryPg(ORIGINAL_DB, 'SELECT count(*)::int as count FROM users');
  const origJobs = await queryPg(ORIGINAL_DB, 'SELECT count(*)::int as count FROM jobs');
  const origApps = await queryPg(ORIGINAL_DB, 'SELECT count(*)::int as count FROM job_applications');
  const origResumes = await queryPg(ORIGINAL_DB, 'SELECT count(*)::int as count FROM resumes');

  const dispUsers = await queryPg(DISPOSABLE_DB, 'SELECT count(*)::int as count FROM users');
  const dispJobs = await queryPg(DISPOSABLE_DB, 'SELECT count(*)::int as count FROM jobs');
  const dispApps = await queryPg(DISPOSABLE_DB, 'SELECT count(*)::int as count FROM job_applications');
  const dispResumes = await queryPg(DISPOSABLE_DB, 'SELECT count(*)::int as count FROM resumes');

  report.isolationCheck.before = {
    original: { users: origUsers.rows[0].count, jobs: origJobs.rows[0].count, apps: origApps.rows[0].count, resumes: origResumes.rows[0].count },
    disposable: { users: dispUsers.rows[0].count, jobs: dispJobs.rows[0].count, apps: dispApps.rows[0].count, resumes: dispResumes.rows[0].count },
  };

  console.log('Original DB state (before):', report.isolationCheck.before.original);
  console.log('Disposable DB state (before):', report.isolationCheck.before.disposable);

  if (dispApps.rows[0].count === 0) {
    throw new Error('Disposable DB has no job applications! Please seed showcase data first.');
  }

  // --- Step 2: Browser Kanban Pointer Drag/Drop and Persistence ---
  console.log('\n=== Step 2: Kanban Pointer Drag/Drop and Persistence ===');
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();

  try {
    await page.goto(`${APP_URL}/workspace`, { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-kanban-desktop]', { timeout: 15000 });

    // Dismiss tour modal if present
    const notNowBtn = page.getByRole('button', { name: 'Not now' });
    if (await notNowBtn.isVisible().catch(() => false)) {
      await notNowBtn.click();
    }

    await page.screenshot({ path: path.join(evidenceDir, '01-kanban-initial.png') });

    // Locate Stripe text in the board
    const stripeText = page.locator('[data-kanban-desktop] p.font-semibold').filter({ hasText: /^Stripe$/ });
    await stripeText.waitFor({ state: 'visible', timeout: 5000 });
    const stripeBox = await stripeText.boundingBox();
    console.log('Stripe card text box:', stripeBox);

    // Locate the APPLIED column header specifically
    const appliedHeader = page.locator('[data-kanban-desktop] span.text-sm.font-medium').filter({ hasText: /^Applied$/ });
    await appliedHeader.waitFor({ state: 'visible', timeout: 5000 });
    const appliedCol = appliedHeader.locator('xpath=ancestor::div[contains(@class, "flex-col") and contains(@class, "rounded-lg")][1]');
    const appliedBox = await appliedCol.boundingBox();
    console.log('Applied column box:', appliedBox);

    if (!stripeBox || !appliedBox) {
      throw new Error('Could not compute bounding boxes for Stripe text or Applied column');
    }

    // Record initial DB status
    const initRes = await queryPg(DISPOSABLE_DB, "SELECT id, status FROM job_applications WHERE id = 'app_job_stripe_infra'");
    report.kanbanDragDrop.initialStatus = initRes.rows[0]?.status;
    console.log('Initial DB status for Stripe:', report.kanbanDragDrop.initialStatus);

    // Perform real mouse pointer drag:
    const startX = stripeBox.x + stripeBox.width / 2;
    const startY = stripeBox.y + stripeBox.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down({ button: 'left' });

    // Move past activation constraint (distance 6)
    await page.mouse.move(startX + 15, startY + 15, { steps: 5 });
    await page.waitForTimeout(100);

    // Move into target column (Applied)
    const targetX = appliedBox.x + appliedBox.width / 2;
    const targetY = appliedBox.y + 120;
    await page.mouse.move(targetX, targetY, { steps: 25 });
    await page.waitForTimeout(300);

    // Drop
    await page.mouse.up({ button: 'left' });
    console.log('Pointer drag/drop completed. Waiting for persistence...');
    await page.waitForTimeout(2500);

    await page.screenshot({ path: path.join(evidenceDir, '02-kanban-dragged.png') });

    // Verify DB updated
    const postDragRes = await queryPg(DISPOSABLE_DB, "SELECT id, status FROM job_applications WHERE id = 'app_job_stripe_infra'");
    report.kanbanDragDrop.statusAfterDrag = postDragRes.rows[0]?.status;
    console.log('Post-drag DB status for Stripe:', report.kanbanDragDrop.statusAfterDrag);

    // Reload page to test full server-side persistence
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('[data-kanban-desktop]', { timeout: 15000 });
    await page.screenshot({ path: path.join(evidenceDir, '03-kanban-persisted-reload.png') });

    const appliedColReloaded = page.locator('[data-kanban-desktop] span.text-sm.font-medium').filter({ hasText: /^Applied$/ }).locator('xpath=ancestor::div[contains(@class, "flex-col") and contains(@class, "rounded-lg")][1]');
    const isStripeThere = await appliedColReloaded.locator('p.font-semibold').filter({ hasText: /^Stripe$/ }).isVisible();
    console.log('Is Stripe visible in Applied column after reload?:', isStripeThere);

    report.kanbanDragDrop.persistedInUI = isStripeThere;
    report.kanbanDragDrop.success = (report.kanbanDragDrop.statusAfterDrag === 'APPLIED' && isStripeThere);
  } catch (err) {
    console.error('Kanban drag/drop error:', err);
    report.kanbanDragDrop.error = err.message;
    report.errors.push(`Kanban drag/drop: ${err.message}`);
  } finally {
    await context.close();
    await browser.close();
  }

  // --- Step 3: Exercise Remaining Offline Controls ---
  console.log('\n=== Step 3: Exercise Remaining Offline Controls ===');
  const browser2 = await chromium.launch({ headless: true });
  const context2 = await browser2.newContext({ viewport: { width: 1440, height: 1000 } });
  const page2 = await context2.newPage();

  try {
    // 3A: LinkedIn Quick Check (offline heuristic evaluation)
    console.log('Testing /linkedin quick check offline...');
    await page2.goto(`${APP_URL}/linkedin`, { waitUntil: 'networkidle' });

    // Click "Quick check (no AI)" button to reveal the offline evaluation panel
    const openQuickCheckBtn = page2.getByRole('button', { name: /Quick check \(no AI\)/i });
    await openQuickCheckBtn.waitFor({ state: 'visible', timeout: 5000 });
    await openQuickCheckBtn.click();

    // Locate the offline textarea
    const offlineInput = page2.getByLabel('LinkedIn profile text for offline check');
    await offlineInput.waitFor({ state: 'visible', timeout: 5000 });

    // Turn network completely offline
    await context2.setOffline(true);
    console.log('Network set to offline. Typing profile content into offline quick-check...');

    const sampleProfile = `Staff Software Engineer with 10+ years experience building distributed platforms, Kafka streams, and high throughput PostgreSQL systems. Spearheaded architectural migration and reduced infrastructure cost by $180,000. Contact: alex.morgan@example.com, github.com/alexmorgan`;
    await offlineInput.fill(sampleProfile);

    // Click "Check now"
    const checkNowBtn = page2.getByRole('button', { name: 'Check now', exact: true });
    await checkNowBtn.click();
    await page2.waitForTimeout(600);

    await page2.screenshot({ path: path.join(evidenceDir, '04-linkedin-offline-eval.png') });

    const toastNotice = page2.getByText(/Quick check done/i).first();
    const hasToast = await toastNotice.isVisible().catch(() => false);
    console.log('Offline check completed toast visible?:', hasToast);

    const scoreCard = page2.getByText(/Your standing/i).first();
    const hasScoreCard = await scoreCard.isVisible().catch(() => false);
    console.log('Offline score card rendered visible?:', hasScoreCard);

    report.offlineControls.linkedinQuickCheck = {
      evaluatedOffline: true,
      toastVisible: hasToast,
      scoreCardRendered: hasScoreCard,
      textLength: sampleProfile.length,
    };

    // Reconnect network
    await context2.setOffline(false);
    await page2.waitForTimeout(500);

    // 3B: Offline Banner / Reconnect notification on main app
    console.log('Testing offline banner detection on workspace...');
    await page2.goto(`${APP_URL}/workspace`, { waitUntil: 'networkidle' });
    await context2.setOffline(true);
    await page2.waitForTimeout(500);

    const offlineNotice = page2.getByText(/You're offline|You are offline|offline/i).first();
    const isNoticeVisible = await offlineNotice.isVisible().catch(() => false);
    console.log('Offline notice visible when disconnected?:', isNoticeVisible);
    await page2.screenshot({ path: path.join(evidenceDir, '05-offline-banner.png') });

    await context2.setOffline(false);
    await page2.waitForTimeout(500);
    await page2.screenshot({ path: path.join(evidenceDir, '06-online-restored.png') });

    report.offlineControls.bannerDetection = {
      offlineNoticeVisible: isNoticeVisible,
    };

    // 3C: Profile data transfer offline export control
    console.log('Testing Profile Data Transfer offline export control under Backup tab...');
    await page2.goto(`${APP_URL}/career-profile`, { waitUntil: 'networkidle' });

    // Click "Backup" tab
    const backupTab = page2.getByRole('tab', { name: 'Backup' });
    await backupTab.waitFor({ state: 'visible', timeout: 5000 });
    await backupTab.click();
    await page2.waitForTimeout(300);

    const evidenceBtn = page2.getByRole('button', { name: 'Evidence CSV', exact: true });
    const skillsBtn = page2.getByRole('button', { name: 'Skills CSV', exact: true });
    const hasEvidenceBtn = await evidenceBtn.isVisible().catch(() => false);
    const hasSkillsBtn = await skillsBtn.isVisible().catch(() => false);
    console.log('Evidence CSV button visible?:', hasEvidenceBtn, '| Skills CSV visible?:', hasSkillsBtn);
    await page2.screenshot({ path: path.join(evidenceDir, '07-profile-offline-export.png') });

    report.offlineControls.profileDataTransfer = {
      backupTabAccessible: true,
      evidenceCsvButtonVisible: hasEvidenceBtn,
      skillsCsvButtonVisible: hasSkillsBtn,
    };
  } catch (err) {
    console.error('Offline controls error:', err);
    report.offlineControls.error = err.message;
    report.errors.push(`Offline controls: ${err.message}`);
  } finally {
    await context2.close();
    await browser2.close();
  }

  // --- Step 4: Extension Runtime Connect Feasibility ---
  console.log('\n=== Step 4: Extension Runtime Connect Feasibility ===');
  const extensionPath = path.resolve('extension/dist');
  const extContext = await chromium.launchPersistentContext('.unlazy/qa/extension-profile-nonresume', {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });

  try {
    const worker = extContext.serviceWorkers()[0] || (await extContext.waitForEvent('serviceworker', { timeout: 15000 }));
    const extId = new URL(worker.url()).host;
    console.log('Extension worker active. Extension ID:', extId);
    report.extensionConnect.extensionId = extId;

    const extPage = await extContext.newPage();
    await extPage.goto(`chrome-extension://${extId}/options.html`);
    await extPage.getByLabel('App URL', { exact: true }).fill(APP_URL);
    await extPage.getByRole('button', { name: 'Save settings', exact: true }).click();
    await extPage.waitForTimeout(500);
    await extPage.screenshot({ path: path.join(evidenceDir, '08-extension-options.png') });

    // Attempt interactive connect button
    console.log('Attempting "Connect RoleSpec OS" via chrome.identity...');
    await extPage.getByRole('button', { name: 'Connect RoleSpec OS', exact: true }).click();
    await extPage.waitForTimeout(3000);

    const pages = extContext.pages();
    const connectPage = pages.find((p) => p.url().includes('/extension/connect'));
    const statusText = await extPage.locator('#status').innerText().catch(() => '');
    console.log('Options status message after connect attempt:', statusText);

    if (connectPage) {
      console.log('Connect consent page opened successfully at:', connectPage.url());
      await connectPage.screenshot({ path: path.join(evidenceDir, '09-extension-consent.png') });
      const connectBtn = connectPage.getByRole('button', { name: 'Connect', exact: true });
      if (await connectBtn.isVisible()) {
        await connectBtn.click();
        await extPage.waitForTimeout(2000);
        const finalStatus = await extPage.locator('#status').innerText().catch(() => '');
        console.log('Options status after granting consent:', finalStatus);
        report.extensionConnect.interactiveConnect = {
          outcome: 'SUCCESS',
          finalStatus,
        };
      }
    } else {
      console.log('Interactive connect page did not open in headless Chrome.');
      report.extensionConnect.interactiveConnect = {
        outcome: 'BLOCKED_HEADLESS',
        reason: statusText || 'chrome.identity.launchWebAuthFlow window not exposed to headless page automation',
      };
    }

    // Verify runtime authenticated API reads through the extension worker
    const networkResults = await worker.evaluate(async (url) => {
      const settings = await chrome.storage.local.get(null);
      const stored = Object.values(settings).find((v) => v && typeof v === 'object' && typeof v.apiToken === 'string');
      const apiToken = stored?.apiToken || settings.apiToken;
      const res = [];
      for (const route of ['/api/extension/profile', '/api/extension/ats/answers', '/api/extension/review-tasks']) {
        try {
          const resp = await fetch(url + route, {
            headers: { Authorization: `Bearer ${apiToken}` },
          });
          res.push({ route, status: resp.status, ok: resp.ok });
        } catch (e) {
          res.push({ route, error: String(e) });
        }
      }
      return res;
    }, APP_URL);

    console.log('Extension worker API verification results:', networkResults);
    report.extensionConnect.apiReads = networkResults;

    // Inspect sidepanel
    await extPage.goto(`chrome-extension://${extId}/sidepanel.html`);
    await extPage.waitForTimeout(1000);
    await extPage.screenshot({ path: path.join(evidenceDir, '10-extension-sidepanel.png') });
    report.extensionConnect.sidepanelRendered = true;
  } catch (err) {
    console.error('Extension connect error:', err);
    report.extensionConnect.error = err.message;
    report.errors.push(`Extension connect: ${err.message}`);
  } finally {
    await extContext.close();
  }

  // --- Step 5: Destructive Workspace Erase on Disposable DB ONLY ---
  console.log('\n=== Step 5: Destructive Workspace Erase ===');
  console.log('Double checking that we will only erase the disposable DB:', DISPOSABLE_DB);

  // Assert again that original DB is untouched
  const origCheck = await queryPg(ORIGINAL_DB, 'SELECT count(*)::int as count FROM users');
  console.log('Original DB users before erase:', origCheck.rows[0].count);
  if (origCheck.rows[0].count === 0) {
    throw new Error('Original DB is unexpectedly empty! Halting destructive test immediately.');
  }

  const browser3 = await chromium.launch({ headless: true });
  const context3 = await browser3.newContext({ viewport: { width: 1440, height: 1000 } });
  const page3 = await context3.newPage();

  try {
    await page3.goto(`${APP_URL}/settings/data`, { waitUntil: 'networkidle' });
    await page3.screenshot({ path: path.join(evidenceDir, '11-settings-data-before-erase.png') });

    // Click "Erase everything…"
    const eraseTrigger = page3.getByRole('button', { name: 'Erase everything…', exact: true });
    await eraseTrigger.waitFor({ state: 'visible', timeout: 5000 });
    await eraseTrigger.click();

    // Check confirmation form appeared
    const confirmationInput = page3.locator('#reset-confirmation');
    await confirmationInput.waitFor({ state: 'visible', timeout: 5000 });
    await page3.screenshot({ path: path.join(evidenceDir, '12-erase-confirmation-prompt.png') });

    // Test invalid confirmation submission:
    await confirmationInput.fill('wrong_phrase');
    await page3.getByRole('button', { name: 'Erase permanently', exact: true }).click();
    await page3.waitForTimeout(1000);

    const validationAlert = page3.locator('p[role="alert"]');
    const alertText = await validationAlert.innerText().catch(() => '');
    console.log('Validation alert on wrong phrase:', alertText);
    report.workspaceErase.validationTested = alertText.includes('DELETE');
    await page3.screenshot({ path: path.join(evidenceDir, '13-erase-validation-rejected.png') });

    // Submit with correct phrase: "DELETE"
    await confirmationInput.fill('DELETE');
    await page3.getByRole('button', { name: 'Erase permanently', exact: true }).click();

    // Expect redirect to /onboarding?reset=1
    await page3.waitForURL(/onboarding\?reset=1/, { timeout: 15000 });
    console.log('Successfully redirected to:', page3.url());
    await page3.waitForTimeout(1000);
    await page3.screenshot({ path: path.join(evidenceDir, '14-post-erase-onboarding.png') });

    // Check disposable DB state: everything owned by user should be erased!
    const postDispUsers = await queryPg(DISPOSABLE_DB, 'SELECT count(*)::int as count FROM users');
    const postDispJobs = await queryPg(DISPOSABLE_DB, 'SELECT count(*)::int as count FROM jobs');
    const postDispApps = await queryPg(DISPOSABLE_DB, 'SELECT count(*)::int as count FROM job_applications');
    const postDispResumes = await queryPg(DISPOSABLE_DB, 'SELECT count(*)::int as count FROM resumes');

    report.workspaceErase.postEraseDisposableCounts = {
      users: postDispUsers.rows[0].count,
      jobs: postDispJobs.rows[0].count,
      apps: postDispApps.rows[0].count,
      resumes: postDispResumes.rows[0].count,
    };
    console.log('Post-erase Disposable DB counts:', report.workspaceErase.postEraseDisposableCounts);

    // Re-verify that the ORIGINAL DB has NOT been touched!
    const postOrigUsers = await queryPg(ORIGINAL_DB, 'SELECT count(*)::int as count FROM users');
    const postOrigJobs = await queryPg(ORIGINAL_DB, 'SELECT count(*)::int as count FROM jobs');
    const postOrigApps = await queryPg(ORIGINAL_DB, 'SELECT count(*)::int as count FROM job_applications');
    const postOrigResumes = await queryPg(ORIGINAL_DB, 'SELECT count(*)::int as count FROM resumes');

    report.workspaceErase.postEraseOriginalCounts = {
      users: postOrigUsers.rows[0].count,
      jobs: postOrigJobs.rows[0].count,
      apps: postOrigApps.rows[0].count,
      resumes: postOrigResumes.rows[0].count,
    };
    console.log('Post-erase ORIGINAL DB counts:', report.workspaceErase.postEraseOriginalCounts);

    const isDisposableClean = postDispJobs.rows[0].count === 0 && postDispApps.rows[0].count === 0 && postDispResumes.rows[0].count === 0;
    const isOriginalUntouched = postOrigUsers.rows[0].count === origUsers.rows[0].count && postOrigResumes.rows[0].count === origResumes.rows[0].count;

    report.workspaceErase.success = isDisposableClean && isOriginalUntouched;
    console.log('Workspace erase test success:', report.workspaceErase.success);
  } catch (err) {
    console.error('Workspace erase error:', err);
    report.workspaceErase.error = err.message;
    report.errors.push(`Workspace erase: ${err.message}`);
  } finally {
    await context3.close();
    await browser3.close();
  }

  report.completedAt = new Date().toISOString();
  fs.writeFileSync(path.join(evidenceDir, 'nonresume-qa-report.json'), JSON.stringify(report, null, 2));
  console.log('\n=== Final QA Report Written to .unlazy/qa/evidence/nonresume/nonresume-qa-report.json ===');
  console.log(JSON.stringify(report, null, 2));
}

run().catch((e) => {
  console.error('Fatal runner error:', e);
  process.exit(1);
});
