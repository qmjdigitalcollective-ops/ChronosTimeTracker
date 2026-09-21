/**
 * GOOGLE APPS SCRIPT CONNECTOR FOR TIME TRACKER
 *
 * HOW TO DEPLOY:
 * 1. Open Google Sheets (create a new blank sheet).
 * 2. In the menu, go to: Extensions > Apps Script.
 * 3. Delete any existing code and PASTE this entire script.
 * 4. Click the blue "Deploy" button (top right) > "New deployment".
 * 5. Select type: "Web app".
 * 6. Set Description: "Time Tracker Sync Endpoint".
 * 7. Set "Execute as": "Me".
 * 8. Set "Who has access": "Anyone" (crucial for local web app to post data).
 * 9. Click "Deploy", authorize permissions when prompted, and COPY the Web App URL.
 * 10. Paste the Web App URL into the Time Tracker Admin Settings!
 */

function doGet(e) {
  return ContentService.createTextOutput(
    JSON.stringify({
      status: 'ok',
      message: 'Google Sheets & Drive Time Tracker API is active!',
      timestamp: new Date().toISOString()
    })
  ).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    var rawData = e.postData ? e.postData.contents : '';
    if (!rawData) {
      return responseJSON({ success: false, error: 'Empty payload' });
    }

    var payload = JSON.parse(rawData);
    var action = payload.action || 'syncTimeLogs';

    if (action === 'ping') {
      return responseJSON({
        success: true,
        message: 'Connected to Google Sheets & Drive successfully!',
        sheetName: SpreadsheetApp.getActiveSpreadsheet().getName()
      });
    }

    if (action === 'syncTimeLogs') {
      return handleSyncTimeLogs(payload);
    }

    return responseJSON({ success: false, error: 'Unknown action: ' + action });
  } catch (err) {
    return responseJSON({ success: false, error: err.toString() });
  }
}

function handleSyncTimeLogs(payload) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var logSheet = getOrCreateSheet(ss, 'TimeLogs', [
    'Entry ID',
    'Date',
    'Employee Name',
    'Client Name',
    'Task Description',
    'Start Time',
    'End Time',
    'Duration (Hours)',
    'Hourly Rate ($)',
    'Total Pay ($)',
    'Screenshot Count',
    'Drive Screenshot Links',
    'Synced At'
  ]);

  var driveFolder = getOrCreateDriveFolder('TimeTracker_Screenshots');
  var screenshotMap = {};

  // Process screenshots first and upload to Google Drive
  if (payload.screenshots && Array.isArray(payload.screenshots)) {
    for (var i = 0; i < payload.screenshots.length; i++) {
      var ssItem = payload.screenshots[i];
      if (ssItem.imageDataUrl && ssItem.imageDataUrl.indexOf('base64,') > -1) {
        var base64Data = ssItem.imageDataUrl.split('base64,')[1];
        var decodedBytes = Utilities.base64Decode(base64Data);
        var filename = 'SS_' + (ssItem.employeeName || 'User').replace(/[^a-zA-Z0-9]/g, '_') +
                       '_' + (ssItem.timestamp || Date.now()) + '.jpg';
        var blob = Utilities.newBlob(decodedBytes, 'image/jpeg', filename);
        var file = driveFolder.createFile(blob);
        file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

        screenshotMap[ssItem.id] = {
          fileId: file.getId(),
          viewUrl: file.getUrl()
        };
      }
    }
  }

  // Append or update Time Entries in Google Sheet
  var syncedCount = 0;
  if (payload.entries && Array.isArray(payload.entries)) {
    var existingIds = getExistingEntryIds(logSheet);

    for (var j = 0; j < payload.entries.length; j++) {
      var entry = payload.entries[j];
      var startDate = new Date(entry.startTime);
      var endDate = entry.endTime ? new Date(entry.endTime) : new Date();
      var durationHours = (entry.durationSeconds / 3600).toFixed(2);
      var totalPay = entry.totalPay ? entry.totalPay.toFixed(2) : ((entry.durationSeconds / 3600) * entry.hourlyRate).toFixed(2);

      // Collect drive URLs for this entry's screenshots
      var links = [];
      if (payload.screenshots) {
        for (var k = 0; k < payload.screenshots.length; k++) {
          var s = payload.screenshots[k];
          if (s.timeEntryId === entry.id && screenshotMap[s.id]) {
            links.push(screenshotMap[s.id].viewUrl);
          }
        }
      }
      var driveLinksStr = links.join('\n');

      var rowData = [
        entry.id,
        startDate.toLocaleDateString(),
        entry.employeeName,
        entry.clientName,
        entry.taskDescription,
        startDate.toLocaleTimeString(),
        entry.endTime ? endDate.toLocaleTimeString() : 'In Progress',
        parseFloat(durationHours),
        entry.hourlyRate,
        parseFloat(totalPay),
        entry.screenshotCount || 0,
        driveLinksStr,
        new Date().toISOString()
      ];

      // Check if entry already exists (update row) or insert new row
      var existingRowIndex = existingIds[entry.id];
      if (existingRowIndex) {
        logSheet.getRange(existingRowIndex, 1, 1, rowData.length).setValues([rowData]);
      } else {
        logSheet.appendRow(rowData);
      }
      syncedCount++;
    }
  }

  // Format header row style
  formatHeaderStyle(logSheet);

  return responseJSON({
    success: true,
    message: 'Synced ' + syncedCount + ' time entries successfully.',
    syncedCount: syncedCount,
    screenshotMap: screenshotMap
  });
}

function getExistingEntryIds(sheet) {
  var ids = {};
  var lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    var range = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < range.length; i++) {
      var id = range[i][0];
      if (id) {
        ids[id] = i + 2; // Row index (1-based, +2 for 1 header row + 0 index)
      }
    }
  }
  return ids;
}

function getOrCreateSheet(ss, sheetName, headers) {
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    sheet.appendRow(headers);
    formatHeaderStyle(sheet);
  }
  return sheet;
}

function formatHeaderStyle(sheet) {
  var headerRange = sheet.getRange(1, 1, 1, sheet.getLastColumn() || 13);
  headerRange.setBackground('#1e293b');
  headerRange.setFontColor('#ffffff');
  headerRange.setFontWeight('bold');
  sheet.setFrozenRows(1);
}

function getOrCreateDriveFolder(folderName) {
  var folders = DriveApp.getFoldersByName(folderName);
  if (folders.hasNext()) {
    return folders.next();
  }
  var newFolder = DriveApp.createFolder(folderName);
  newFolder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return newFolder;
}

function responseJSON(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
