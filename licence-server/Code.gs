// TenderAssist licence server: a Google Sheet plus this Apps Script.
//
// The sheet is the owner's control panel: one row per key, with its customer,
// Google account, PCs allowed, expiry date, grace days and status. Editing a
// cell is the change; the app sees it at its next check (every 6 hours, and at
// every start). The script is also published as a web app the TenderAssist
// app calls to activate and check a key. Its answers are signed with the
// licence private key, so an app cannot be fooled by an edited file or a fake
// server. Setup: docs/licence-setup.md.

var KEYS = 'Keys';
var PCS = 'PCs';
var LOG = 'Log';
var SETTINGS = 'Settings';

var KEY_HEADERS = ['Key', 'Customer', 'Contact', 'Google account', 'Plan', 'PCs allowed', 'Issued', 'Expires on', 'Grace days',
  'Status', 'Days left', 'PCs in use', 'Last seen', 'App version', 'Notes'];
var PC_HEADERS = ['Key', 'PC ID', 'PC name', 'Google account', 'First seen', 'Last seen', 'App version'];
var LOG_HEADERS = ['Time', 'Key', 'Google account', 'PC name', 'Action', 'Result'];

var COL = {}; KEY_HEADERS.forEach(function (name, index) { COL[name] = index; });
var PC_COL = {}; PC_HEADERS.forEach(function (name, index) { PC_COL[name] = index; });

var PLANS = ['Trial', 'Paid'];
var STATUSES = ['Active', 'Suspended', 'Revoked'];
var DEFAULT_GRACE_DAYS = 3;
var REMIND_DAYS = 3;
var DAY_MS = 24 * 60 * 60 * 1000;
/** No 0/O, 1/I/L: a key read out over the phone cannot be mistaken. */
var KEY_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

// ── Pure rules (no Sheets calls; tested from tests/licence/licenceServer.test.ts) ──

/** A new key from 20 random bytes: TA-XXXXX-XXXXX-XXXXX-XXXXX. */
function makeKey(bytes) {
  var chars = '';
  for (var i = 0; i < 20; i++) chars += KEY_ALPHABET.charAt(((bytes[i] % 256) + 256) % 256 % KEY_ALPHABET.length);
  return 'TA-' + chars.slice(0, 5) + '-' + chars.slice(5, 10) + '-' + chars.slice(10, 15) + '-' + chars.slice(15, 20);
}

/** The key as typed or pasted (any case, spaces, dashes) in its stored form, or '' when it cannot be one. */
function normaliseKey(text) {
  var plain = String(text || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (plain.indexOf('TA') === 0 && plain.length === 22) plain = plain.slice(2);
  if (plain.length !== 20) return '';
  for (var i = 0; i < plain.length; i++) if (KEY_ALPHABET.indexOf(plain.charAt(i)) < 0) return '';
  return 'TA-' + plain.slice(0, 5) + '-' + plain.slice(5, 10) + '-' + plain.slice(10, 15) + '-' + plain.slice(15, 20);
}

/** "Expires on" is the last day the key works: it ends at the following midnight (sheet time). */
function keyWindow(row) {
  var expires = row[COL['Expires on']];
  if (!(expires instanceof Date) || isNaN(expires.getTime())) return null;
  var cell = row[COL['Grace days']];
  // An empty cell means the default, not 0 (Number('') is 0).
  var graceDays = cell === '' || cell == null ? DEFAULT_GRACE_DAYS : Number(cell);
  if (!(graceDays >= 0)) graceDays = DEFAULT_GRACE_DAYS;
  var endsAt = new Date(expires.getFullYear(), expires.getMonth(), expires.getDate() + 1);
  return { endsAt: endsAt, graceUntil: new Date(endsAt.getTime() + Math.round(graceDays) * DAY_MS) };
}

function sameAccount(a, b) {
  return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
}

/**
 * What the server answers for a request against a key's row.
 * request: { action: 'activate' | 'check', pcId, account (activate: verified Google email) }
 * pcs: the PC IDs already on this key.
 * Returns { ok, code, message, bindAccount?, addPc?, licence? }.
 */
function decide(row, request, pcs, now) {
  if (!row) return { ok: false, code: 'unknown-key', message: 'This key is not recognised. Check it, or ask for a new one.' };
  var window = keyWindow(row);
  if (!window) return { ok: false, code: 'not-ready', message: 'This key has no end date yet. Ask the person who gave it to you.' };
  var key = row[COL['Key']];
  var bound = String(row[COL['Google account']] || '').trim();
  var allowed = Math.max(1, Math.round(Number(row[COL['PCs allowed']]) || 1));
  var known = pcs.indexOf(request.pcId) >= 0;
  var result = { ok: true, code: 'ok', message: '' };

  if (request.action === 'activate') {
    var status = row[COL['Status']];
    if (status === 'Suspended' || status === 'Revoked' || window.graceUntil.getTime() <= now.getTime()) {
      return { ok: false, code: 'ended', message: status === 'Suspended' ? 'This key is suspended. Ask the person who gave it to you.' : 'This key has ended. Ask for a new one.' };
    }
    if (!request.account) return { ok: false, code: 'sign-in-failed', message: 'Google sign-in could not be confirmed. Try again.' };
    if (bound && !sameAccount(bound, request.account)) {
      return { ok: false, code: 'other-account', message: 'This key belongs to another Google account (' + maskEmail(bound) + '). Sign in with that account, or ask for a new key.' };
    }
    if (!bound) result.bindAccount = request.account;
    if (!known) {
      if (pcs.length >= allowed) {
        return { ok: false, code: 'too-many-pcs', message: 'This key is already used on ' + pcs.length + (pcs.length === 1 ? ' PC' : ' PCs') + ', its limit. Ask to add a PC or to move the key to this one.' };
      }
      result.addPc = true;
    }
  } else if (!known) {
    return { ok: false, code: 'pc-not-activated', message: 'This PC is no longer on the key. Activate it again.' };
  }

  result.licence = {
    v: 1,
    key: key,
    customer: String(row[COL['Customer']] || ''),
    account: bound || request.account || '',
    pcId: request.pcId,
    plan: PLANS.indexOf(row[COL['Plan']]) >= 0 ? row[COL['Plan']] : 'Paid',
    status: STATUSES.indexOf(row[COL['Status']]) >= 0 ? row[COL['Status']] : 'Active',
    endsAt: window.endsAt.toISOString(),
    graceUntil: window.graceUntil.toISOString(),
    pcsAllowed: allowed,
    pcsInUse: pcs.length + (result.addPc ? 1 : 0),
    checkedAt: now.toISOString(),
  };
  return result;
}

function maskEmail(email) {
  var parts = String(email).split('@');
  if (parts.length !== 2) return 'another account';
  return parts[0].charAt(0) + '•••@' + parts[1];
}

/** The private key as PEM, whatever way it was pasted (with or without header, on one line). */
function pemFrom(text) {
  var body = String(text || '').replace(/-----[A-Z ]+-----/g, '').replace(/\s+/g, '');
  if (!body) return '';
  var lines = body.match(/.{1,64}/g).join('\n');
  return '-----BEGIN PRIVATE KEY-----\n' + lines + '\n-----END PRIVATE KEY-----\n';
}

function shareMessage(row, timeZone) {
  var expires = row[COL['Expires on']];
  var until = expires instanceof Date ? Utilities.formatDate(expires, timeZone, 'd MMM yyyy') : 'the date agreed';
  var pcs = Math.max(1, Number(row[COL['PCs allowed']]) || 1);
  return 'Your TenderAssist key' + (row[COL['Customer']] ? ' for ' + row[COL['Customer']] : '') + ':\n\n' +
    row[COL['Key']] + '\n\n' +
    (row[COL['Plan']] === 'Trial' ? 'Trial' : 'Valid') + ' until ' + until + ', on ' + pcs + (pcs === 1 ? ' PC' : ' PCs') + '.\n\n' +
    'To start: install TenderAssist, paste this key when the installer asks, then sign in with the Google account ' +
    'you will use. The key is linked to that Google account.';
}

// ── Web app: called by TenderAssist ──────────────────────────────────────────

/** The installer's quick look: is this key real and still working? Nothing is changed. */
function doGet(e) {
  var params = (e && e.parameter) || {};
  if (params.action !== 'peek') return json({ ok: false, code: 'bad-request', message: 'TenderAssist licence server.' });
  var key = normaliseKey(params.key);
  var found = key ? findKeyRow(key) : null;
  if (!found) return json({ ok: false, code: 'unknown-key', message: 'This key is not recognised. Check it, or ask for a new one.' });
  var window = keyWindow(found.row);
  var status = found.row[COL['Status']];
  if (!window || status === 'Suspended' || status === 'Revoked' || window.graceUntil.getTime() <= Date.now()) {
    var why = status === 'Suspended' ? 'This key is suspended.' : status === 'Revoked' ? 'This key was withdrawn.' : 'This key has ended.';
    return json({ ok: false, code: 'ended', message: (why + ' ' + contactLine()).trim() });
  }
  return json({ ok: true, code: 'ok', message: '', customer: String(found.row[COL['Customer']] || '') });
}

function doPost(e) {
  var body;
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); }
  catch (err) { return json({ ok: false, code: 'bad-request', message: 'The request could not be read.' }); }
  var key = normaliseKey(body.key);
  var pcId = String(body.pcId || '').slice(0, 128);
  if ((body.action !== 'activate' && body.action !== 'check') || !pcId) {
    return json({ ok: false, code: 'bad-request', message: 'The request was incomplete.' });
  }
  if (!key) return json({ ok: false, code: 'unknown-key', message: 'This key is not recognised. Check it, or ask for a new one.' });
  var account = '';
  if (body.action === 'activate') account = verifiedGoogleEmail(String(body.idToken || ''));

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var found = findKeyRow(key);
    var pcs = found ? pcRows(key) : [];
    var now = new Date();
    var answer = decide(found && found.row, { action: body.action, pcId: pcId, account: account }, pcs.map(function (pc) { return pc.row[PC_COL['PC ID']]; }), now);
    var pcName = String(body.pcName || '').slice(0, 80);
    var version = String(body.version || '').slice(0, 20);
    if (answer.ok) record(found, answer, pcs, { pcId: pcId, pcName: pcName, version: version, now: now });
    if (body.action === 'activate' || !answer.ok) log(key, account || (found && found.row[COL['Google account']]) || '', pcName, body.action, answer.ok ? 'ok' : answer.code);
    var out = { ok: answer.ok, code: answer.code, message: answer.message, contact: contactLine() };
    if (answer.licence) {
      out.payload = JSON.stringify(answer.licence);
      out.signature = Utilities.base64Encode(Utilities.computeRsaSha256Signature(out.payload, privateKey()));
    }
    return json(out);
  } finally {
    lock.releaseLock();
  }
}

/** The email of a Google ID token made for TenderAssist's own sign-in, or '' when it is not one. */
function verifiedGoogleEmail(idToken) {
  if (!idToken) return '';
  var response = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken), { muteHttpExceptions: true });
  if (response.getResponseCode() !== 200) return '';
  var info = JSON.parse(response.getContentText());
  var clients = String(PropertiesService.getScriptProperties().getProperty('GOOGLE_CLIENT_IDS') || '').split(/[\s,]+/).filter(String);
  if (clients.indexOf(info.aud) < 0) return '';
  if (String(info.email_verified) !== 'true' || Number(info.exp) * 1000 < Date.now()) return '';
  return String(info.email || '').toLowerCase();
}

function record(found, answer, pcs, seen) {
  var sheet = found.sheet;
  var r = found.index + 2;
  if (answer.bindAccount) sheet.getRange(r, COL['Google account'] + 1).setValue(answer.bindAccount);
  sheet.getRange(r, COL['Last seen'] + 1, 1, 2).setValues([[seen.now, seen.version]]);
  var pcSheet = sheetNamed(PCS);
  if (answer.addPc) {
    pcSheet.appendRow([found.row[COL['Key']], seen.pcId, seen.pcName, answer.licence.account, seen.now, seen.now, seen.version]);
    return;
  }
  for (var i = 0; i < pcs.length; i++) {
    if (pcs[i].row[PC_COL['PC ID']] !== seen.pcId) continue;
    pcSheet.getRange(pcs[i].index + 2, PC_COL['PC name'] + 1).setValue(seen.pcName || pcs[i].row[PC_COL['PC name']]);
    pcSheet.getRange(pcs[i].index + 2, PC_COL['Last seen'] + 1, 1, 2).setValues([[seen.now, seen.version]]);
  }
}

function json(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}

/** Uploaded as Secret.gs by licence-server/deploy.cjs, or pasted in Set up (stored in the script's properties). */
function storedPrivateKey() {
  if (typeof LICENCE_PRIVATE_KEY === 'string' && LICENCE_PRIVATE_KEY) return LICENCE_PRIVATE_KEY;
  return PropertiesService.getScriptProperties().getProperty('PRIVATE_KEY');
}

function privateKey() {
  var pem = pemFrom(storedPrivateKey());
  if (!pem) throw new Error('The licence private key is not set. Run Licences → Set up.');
  return pem;
}

// ── Sheet helpers ───────────────────────────────────────────────────────────

/** The bound sheet; a web app call may not have an active one, so Set up remembers its id. */
function book() {
  var active = SpreadsheetApp.getActive();
  if (active) return active;
  var id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (!id) throw new Error('Run Licences → Set up in the sheet first.');
  return SpreadsheetApp.openById(id);
}

function sheetNamed(name) {
  var sheet = book().getSheetByName(name);
  if (!sheet) throw new Error('The "' + name + '" sheet is missing. Run Licences → Set up.');
  return sheet;
}

function dataRows(sheet, width) {
  var last = sheet.getLastRow();
  return last < 2 ? [] : sheet.getRange(2, 1, last - 1, width).getValues();
}

function findKeyRow(key) {
  var sheet = sheetNamed(KEYS);
  var rows = dataRows(sheet, KEY_HEADERS.length);
  for (var i = 0; i < rows.length; i++) {
    if (normaliseKey(rows[i][COL['Key']]) === key) return { sheet: sheet, index: i, row: rows[i] };
  }
  return null;
}

function pcRows(key) {
  var rows = dataRows(sheetNamed(PCS), PC_HEADERS.length);
  var out = [];
  for (var i = 0; i < rows.length; i++) if (normaliseKey(rows[i][PC_COL['Key']]) === key) out.push({ index: i, row: rows[i] });
  return out;
}

function log(key, account, pcName, action, result) {
  try { sheetNamed(LOG).appendRow([new Date(), key, account, pcName, action, result]); } catch (err) { /* logging never blocks an answer */ }
}

function contactLine() {
  try {
    var value = String(sheetNamed(SETTINGS).getRange('B2').getValue() || '').trim();
    return value ? 'Contact: ' + value : '';
  } catch (err) { return ''; }
}

// ── Owner's menu ────────────────────────────────────────────────────────────

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Licences')
    .addItem('New key…', 'showNewKey')
    .addItem('Copy the message for the selected key', 'showShareMessage')
    .addSeparator()
    .addItem('Add 7 days to selected keys', 'addSevenDays')
    .addItem('Take 7 days off selected keys', 'removeSevenDays')
    .addItem('Change days on selected keys…', 'changeDays')
    .addSeparator()
    .addItem('Suspend selected keys', 'suspendSelected')
    .addItem('Make selected keys active', 'activateSelected')
    .addItem('Reset PCs of selected keys', 'resetPcs')
    .addItem('Free the Google account of selected keys', 'freeAccount')
    .addSeparator()
    .addItem('Set up / repair this sheet…', 'setUp')
    .addToUi();
}

/**
 * Makes the tabs, formatting and the morning reminder. Safe to run again.
 * Runs without the sheet's menu, so it also works from the script editor
 * (select prepareSheet, Run): the first run is where Google asks the owner to allow access.
 */
function prepareSheet() {
  var ss = book();
  ss.setSpreadsheetTimeZone('Asia/Kolkata');
  PropertiesService.getScriptProperties().setProperty('SHEET_ID', ss.getId());
  var keys = ensureSheet(KEYS, KEY_HEADERS);
  ensureSheet(PCS, PC_HEADERS);
  ensureSheet(LOG, LOG_HEADERS);
  var settings = ss.getSheetByName(SETTINGS) || ss.insertSheet(SETTINGS);
  if (!settings.getRange('A1').getValue()) {
    settings.getRange('A1:B2').setValues([['Setting', 'Value'], ['Contact shown to customers', '']]);
    settings.getRange('A1:B1').setFontWeight('bold');
    settings.setColumnWidth(1, 220); settings.setColumnWidth(2, 360);
  }

  // Worked out live for every row; never typed.
  keys.getRange(1, COL['Days left'] + 1).setFormula('={"Days left";ARRAYFORMULA(IF(H2:H="","",H2:H-TODAY()))}');
  keys.getRange(1, COL['PCs in use'] + 1).setFormula('={"PCs in use";ARRAYFORMULA(IF(A2:A="","",COUNTIF(PCs!A:A,A2:A)))}');
  keys.getRange('G2:H').setNumberFormat('d mmm yyyy');
  keys.getRange('M2:M').setNumberFormat('d mmm yyyy, h:mm am/pm');
  keys.getRange('K2:K').setNumberFormat('0');
  keys.getRange('E2:E').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(PLANS, true).build());
  keys.getRange('J2:J').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(STATUSES, true).build());
  keys.getRange('H2:H').setDataValidation(SpreadsheetApp.newDataValidation().requireDate().setAllowInvalid(false).build());
  keys.getRange('F2:F').setDataValidation(SpreadsheetApp.newDataValidation().requireNumberBetween(1, 1000).build());
  var all = keys.getRange('A2:O');
  keys.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=AND($A2<>"",OR($J2<>"Active",$K2<0))').setBackground('#f8d7d4').setRanges([all]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenFormulaSatisfied('=AND($A2<>"",$K2>=0,$K2<=' + REMIND_DAYS + ')').setBackground('#fdecc8').setRanges([all]).build(),
  ]);
  sheetNamed(PCS).getRange('E2:F').setNumberFormat('d mmm yyyy, h:mm am/pm');
  sheetNamed(LOG).getRange('A2:A').setNumberFormat('d mmm yyyy, h:mm:ss am/pm');

  ScriptApp.getProjectTriggers().forEach(function (trigger) { if (trigger.getHandlerFunction() === 'dailyReminder') ScriptApp.deleteTrigger(trigger); });
  ScriptApp.newTrigger('dailyReminder').timeBased().everyDays(1).atHour(9).create();
}

/** Licences → Set up: prepares the sheet, then asks for anything still missing. */
function setUp() {
  var ui = SpreadsheetApp.getUi();
  prepareSheet();
  var props = PropertiesService.getScriptProperties();
  if (!storedPrivateKey()) {
    var key = ui.prompt('Licence private key', 'Paste the whole of licence-server/secret/private-key.pem (one line is fine).', ui.ButtonSet.OK_CANCEL);
    if (key.getSelectedButton() === ui.Button.OK && pemFrom(key.getResponseText())) props.setProperty('PRIVATE_KEY', pemFrom(key.getResponseText()));
  }
  if (!props.getProperty('GOOGLE_CLIENT_IDS')) {
    var client = ui.prompt('Google sign-in client ID', 'Paste the client_id from TenderAssist\'s Google sign-in file (ends in .apps.googleusercontent.com). Several can be separated by commas.', ui.ButtonSet.OK_CANCEL);
    if (client.getSelectedButton() === ui.Button.OK && client.getResponseText().trim()) props.setProperty('GOOGLE_CLIENT_IDS', client.getResponseText().trim());
  }

  var missing = [];
  if (!storedPrivateKey()) missing.push('the private key');
  if (!props.getProperty('GOOGLE_CLIENT_IDS')) missing.push('the Google client ID');
  ui.alert(missing.length ? 'Sheet ready, but ' + missing.join(' and ') + ' is still missing. Run Set up again to add it.' : 'Sheet ready. A reminder email comes each morning when keys are about to end.');
}

function ensureSheet(name, headers) {
  var ss = book();
  var sheet = ss.getSheetByName(name) || ss.insertSheet(name);
  var current = sheet.getRange(1, 1, 1, headers.length).getValues()[0];
  headers.forEach(function (header, index) {
    var cell = sheet.getRange(1, index + 1);
    if (!cell.getFormula() && current[index] !== header) cell.setValue(header);
  });
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#e8eef7');
  sheet.setFrozenRows(1);
  return sheet;
}

function showNewKey() {
  SpreadsheetApp.getUi().showModalDialog(HtmlService.createHtmlOutputFromFile('NewKey').setWidth(440).setHeight(560), 'New TenderAssist key');
}

/** Called from NewKey.html. Returns the key and the message to send. */
function createKey(form) {
  var sheet = sheetNamed(KEYS);
  var trial = form.plan === 'Trial';
  var issued = new Date();
  var today = new Date(issued.getFullYear(), issued.getMonth(), issued.getDate());
  var expires;
  if (trial || !form.until) {
    var days = Math.max(1, Math.round(Number(form.days) || 14));
    expires = new Date(today.getFullYear(), today.getMonth(), today.getDate() + days - 1);
  } else {
    var parts = String(form.until).split('-');
    expires = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  }
  if (isNaN(expires.getTime()) || expires < today) throw new Error('The end date must be today or later.');

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var key;
    do { key = makeKey(randomBytes(20)); } while (findKeyRow(key));
    var row = [];
    row[COL['Key']] = key;
    row[COL['Customer']] = String(form.customer || '').trim();
    row[COL['Contact']] = String(form.contact || '').trim();
    row[COL['Google account']] = String(form.account || '').trim().toLowerCase();
    row[COL['Plan']] = trial ? 'Trial' : 'Paid';
    row[COL['PCs allowed']] = Math.max(1, Math.round(Number(form.pcs) || 1));
    row[COL['Issued']] = today;
    row[COL['Expires on']] = expires;
    row[COL['Grace days']] = form.grace === '' || form.grace == null ? DEFAULT_GRACE_DAYS : Math.max(0, Math.round(Number(form.grace) || 0));
    row[COL['Status']] = 'Active';
    row[COL['Notes']] = String(form.notes || '').trim();
    var r = sheet.getLastRow() + 1;
    // Days left and PCs in use are array formulas: leave those two cells empty.
    sheet.getRange(r, 1, 1, COL['Status'] + 1).setValues([row.slice(0, COL['Status'] + 1)]);
    sheet.getRange(r, COL['Notes'] + 1).setValue(row[COL['Notes']]);
    return { key: key, message: shareMessage(row, book().getSpreadsheetTimeZone()) };
  } finally {
    lock.releaseLock();
  }
}

function randomBytes(count) {
  var bytes = [];
  while (bytes.length < count) bytes = bytes.concat(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, Utilities.getUuid() + Utilities.getUuid() + Date.now()));
  return bytes.slice(0, count);
}

/** The Keys rows the owner has selected (any cell in the row counts). */
function selectedKeyRows() {
  var sheet = book().getActiveSheet();
  if (sheet.getName() !== KEYS) throw new Error('Select one or more rows on the Keys sheet first.');
  var rows = {};
  sheet.getActiveRangeList().getRanges().forEach(function (range) {
    for (var r = range.getRow(); r < range.getRow() + range.getNumRows(); r++) if (r >= 2 && r <= sheet.getLastRow()) rows[r] = true;
  });
  var list = Object.keys(rows).map(Number).filter(function (r) { return normaliseKey(sheet.getRange(r, 1).getValue()); });
  if (list.length === 0) throw new Error('Select one or more key rows on the Keys sheet first.');
  return { sheet: sheet, rows: list };
}

function shiftDays(days) {
  var picked = selectedKeyRows();
  picked.rows.forEach(function (r) {
    var cell = picked.sheet.getRange(r, COL['Expires on'] + 1);
    var value = cell.getValue();
    var base = value instanceof Date ? value : new Date();
    cell.setValue(new Date(base.getFullYear(), base.getMonth(), base.getDate() + days));
  });
  book().toast((days > 0 ? 'Added ' + days : 'Took ' + -days + ' off') + ' days on ' + picked.rows.length + (picked.rows.length === 1 ? ' key.' : ' keys.') + ' The app picks it up at its next check.');
}

function addSevenDays() { shiftDays(7); }
function removeSevenDays() { shiftDays(-7); }

function changeDays() {
  var ui = SpreadsheetApp.getUi();
  var answer = ui.prompt('Change days', 'Days to add (e.g. 10), or take off (e.g. -3):', ui.ButtonSet.OK_CANCEL);
  if (answer.getSelectedButton() !== ui.Button.OK) return;
  var days = Math.round(Number(answer.getResponseText()));
  if (!days) { ui.alert('Type a whole number of days, like 10 or -3.'); return; }
  shiftDays(days);
}

function setStatus(status) {
  var picked = selectedKeyRows();
  picked.rows.forEach(function (r) { picked.sheet.getRange(r, COL['Status'] + 1).setValue(status); });
  book().toast(status + ': ' + picked.rows.length + (picked.rows.length === 1 ? ' key.' : ' keys.'));
}

function suspendSelected() { setStatus('Suspended'); }
function activateSelected() { setStatus('Active'); }

function resetPcs() {
  var picked = selectedKeyRows();
  var ui = SpreadsheetApp.getUi();
  if (ui.alert('Reset PCs', 'The PCs on ' + picked.rows.length + (picked.rows.length === 1 ? ' key' : ' keys') + ' stop working at their next check and must activate again. Continue?', ui.ButtonSet.YES_NO) !== ui.Button.YES) return;
  var keys = picked.rows.map(function (r) { return normaliseKey(picked.sheet.getRange(r, 1).getValue()); });
  var pcSheet = sheetNamed(PCS);
  var rows = dataRows(pcSheet, PC_HEADERS.length);
  for (var i = rows.length - 1; i >= 0; i--) if (keys.indexOf(normaliseKey(rows[i][PC_COL['Key']])) >= 0) pcSheet.deleteRow(i + 2);
  keys.forEach(function (key) { log(key, '', '', 'reset-pcs', 'by owner'); });
  book().toast('PCs reset.');
}

function freeAccount() {
  var picked = selectedKeyRows();
  picked.rows.forEach(function (r) { picked.sheet.getRange(r, COL['Google account'] + 1).setValue(''); });
  book().toast('The next Google account to activate each key will own it.');
}

function showShareMessage() {
  var picked = selectedKeyRows();
  var row = picked.sheet.getRange(picked.rows[0], 1, 1, KEY_HEADERS.length).getValues()[0];
  var html = HtmlService.createHtmlOutput(
    '<textarea id="m" style="width:100%;height:220px;font:14px system-ui">' + escapeHtml(shareMessage(row, book().getSpreadsheetTimeZone())) + '</textarea>' +
    '<button onclick="var m=document.getElementById(\'m\');m.select();document.execCommand(\'copy\');this.textContent=\'Copied\'" style="margin-top:8px;padding:8px 14px">Copy</button>'
  ).setWidth(440).setHeight(300);
  SpreadsheetApp.getUi().showModalDialog(html, 'Message for ' + (row[COL['Customer']] || row[COL['Key']]));
}

function escapeHtml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Each morning: the keys that end within REMIND_DAYS, or are in their grace days, by email to the owner. */
function dailyReminder() {
  var rows = dataRows(sheetNamed(KEYS), KEY_HEADERS.length);
  var now = Date.now();
  var lines = [];
  rows.forEach(function (row) {
    var window = keyWindow(row);
    if (!window || row[COL['Status']] !== 'Active' || !normaliseKey(row[COL['Key']])) return;
    var daysLeft = Math.ceil((window.endsAt.getTime() - now) / DAY_MS);
    var who = (row[COL['Customer']] || row[COL['Key']]) + (row[COL['Contact']] ? ' (' + row[COL['Contact']] + ')' : '');
    if (daysLeft > 0 && daysLeft <= REMIND_DAYS) lines.push('• ' + who + ': ends in ' + daysLeft + (daysLeft === 1 ? ' day' : ' days'));
    else if (daysLeft <= 0 && window.graceUntil.getTime() > now) lines.push('• ' + who + ': ended, in grace days; locks ' + Utilities.formatDate(window.graceUntil, book().getSpreadsheetTimeZone(), 'd MMM'));
  });
  if (lines.length === 0) return;
  MailApp.sendEmail(Session.getEffectiveUser().getEmail(), 'TenderAssist keys ending soon (' + lines.length + ')',
    lines.join('\n') + '\n\nExtend them in the sheet: ' + book().getUrl());
}
