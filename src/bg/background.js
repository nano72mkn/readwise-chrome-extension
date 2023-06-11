BASE_URL = "https://readwise.io";
// BASE_URL = "https://local.readwise.io:8000"

AUTHOR_SELECTOR = "p.kp-notebook-metadata.a-spacing-none"

function sendLog(message) {
  console.log("LOG: " + message)
  getRkCookies(function (cookies) {
    postRequest('/api/log/', {
      message: message,
      time: Date.now(),
      accessToken: cookies.accessToken,
      userEmail: cookies.userEmail,
      uniqueSyncId: window.uniqueSyncId,
    })
  });
}


function getRkCookies(callback, forceRefresh) {
  if (window.cookz && window.cookz.accessToken && !forceRefresh) {
    callback(window.cookz);
    return;
  }

  // If we didn't have the rw cookies cached, get them from chrome
  var cookieDomain;
  if (BASE_URL.indexOf("local") !== -1) {
    cookieDomain = ".local.readwise.io";
  } else {
    cookieDomain = ".readwise.io";
  }

  chrome.cookies.getAll({url: BASE_URL, domain: cookieDomain}, function (cookies) {
    window.cookz = {};
    $.each(cookies, function (ind, c) {
      window.cookz[c.name] = c.value;
    });

    if (window.cookz.accessToken) {
      return callback(window.cookz);
    } else {
      // if we didn't get any good cookies for some reason (i.e no access token)
      // then try pulling the cookies from the chrome local storage
      chrome.storage.local.get("rkCookies", function (storageCookies) {
        if (storageCookies.rkCookies) {
          window.cookz = storageCookies.rkCookies;
          return callback(window.cookz);
        } else {
          // final failure: we have no cookies
          return callback({});
        }
      });
    }
  });
}

function onDoneSync() {
  window.startedSyncing = null;
  window.doneSyncing = true;
  sendLog("Done sync, a total of " + (window.currentBookIndex + 1) + " books covered before finishing.");
  chrome.storage.local.set({lastSync: {status: "success", time: Date.now()}});
  setLocalStorageKey("syncedBookHashes", JSON.stringify(window.syncedBookHashes))
}


function isMismatchedAmazonAccount(el) {
  if (window.isForcedSync) {
    return false;
  }

  var greeting = $(".kp-notebook-username", el).text();

  var cookieName = decodeURIComponent(window.cookz.userAmazonName);

  var misMatch = greeting && (greeting !== cookieName);
  if (misMatch) {
    sendLog("Ending sync early because amazon account does not seem to match: " + cookieName + " vs. " + greeting);
  }
  return misMatch
}

function onInitialRequestError(error) {
  sendLog("Ending sync early because initial /notebook request failed -- user is probably logged out? Error: " + error);
  postRequest('/api/extension_logged_out/', {accessToken: window.cookz.accessToken, userEmail: window.cookz.userEmail});
  chrome.storage.local.set({lastSync: {status: "loggedOut"}});
}


// start shared code here: ----------------------------------------------------


function setLocalStorageKey(key, value, retry=true){
  try {
    window.localStorage.setItem(key, value)
    return
  } catch (e) {
    sendLog(`Local storage error: ${e}. Clearing all of the storage...`)
    window.localStorage.clear()
    if (retry) {
      setLocalStorageKey(key, value, retry = false)
    } else {
      throw Error(`Error setting a key in localStorage: ${e}. User email: ${window.cookz.userEmail}`)
    }
  }
}


function hashString(s) {
  // a simple hashing function taken from https://gist.github.com/iperelivskiy/4110988
  for (var i = 0, h = 0xdeadbeef; i < s.length; i++)
    h = Math.imul(h ^ s.charCodeAt(i), 2654435761);
  return (h ^ h >>> 16) >>> 0;
}


function postRequest(url, data, onSuccess, onError) {
  $.ajax({
    type: "POST",
    method: "POST",
    jsonp: false, // https://github.com/jquery/jquery/issues/1799 RIP
    url: BASE_URL + url,
    contentType: "application/json; charset=utf-8",
    dataType: "json",
    data: JSON.stringify(data),
    success: function (resp) {
      if (onSuccess) {
        onSuccess.call(this, resp);
      }
    }.bind(this),
    error: function (resp) {
      if (onError) {
        onError.call(this, resp);
      }
    }.bind(this),
  });
}

// get uses the fetch API (promise-based), despite postRequest using AJAX
function getRequest(url) {
  return fetch(url, {
    headers: window.requestHeaders,
  }).then(function (response) {
    if (!response.ok) {
      throw Error(response.statusText);
    }
    return response.text();
  });
}

function afterSendBookData(isLastBook) {
  if (isLastBook) {
    onDoneSync();
  } else {
    pullNextBook();
  }
}

function sendBookData(bookData, cookies, lastBook) {
  let version;
  if (window.isNativeApp) {
    version = !window.isNativeAppBackground ? "app" : "appbg";
  }
  else {
    version = window.isForcedSync ? "chrome" : "chromebg";
  }

  let payload = JSON.stringify({
    bookData: bookData,
    accessToken: cookies.accessToken,
    userEmail: cookies.userEmail,
    sessionId: cookies.sessionid,
    v: version,
  })

  let hashedPayload = hashString(payload)
  console.log(payload)
  console.log(hashedPayload)
  let bookMatchesPreviousSync = window.syncedBookHashes.includes(hashedPayload) && !window.isForcedSync;
  if (bookMatchesPreviousSync || bookData[window.currentBookId].quotes.length === 0) {
    // Skip sending if we've already sent exactly the same data or it's a book with no highlights
    console.log("Skipping book: " + bookData[window.currentBookId].title)
    afterSendBookData(lastBook);
    return
  }

  console.log("Sending " + window.currentBookId + " (" + bookData[window.currentBookId].title + ")");

  $.ajax({
    type: "POST",
    method: "POST",
    jsonp: false, // https://github.com/jquery/jquery/issues/1799 RIP
    url: BASE_URL + "/async_bd/",
    dataType: "json",
    data: payload,
    success: function (resp) {
      console.log("Sent successfully. Saving hash to local storage...")
      window.syncedBookHashes.push(hashedPayload)
      afterSendBookData(lastBook);
    }.bind(this),
    error: function (resp) {
      console.log("Sent with error.")
      afterSendBookData(lastBook);
    }.bind(this)
  });
}


function onDonePullingBook() {
  var el = window.currentBookEl;
  var bookId = window.currentBookId;
  var bookEl = $("#annotation-scroller", el)[0];
  var bookData = {};

  bookData[bookId] = {
    id: bookId,
    title: bookEl.querySelector("h3.kp-notebook-metadata").textContent.trim(),
    author: bookEl.querySelector(AUTHOR_SELECTOR).textContent.trim(),
    lastHighlightDate: window.allBookDates[bookId],
    quotes: {},
    imageUrl: bookEl.querySelector("img.kp-notebook-cover-image-border") && bookEl.querySelector("img.kp-notebook-cover-image-border").src,
    lastBook: window.currentBookIndex === window.allBookIds.length - 1,
  }

  var asinFromDom = $("#kp-notebook-annotations-asin", el).val();
  if (asinFromDom !== bookId) {
    sendLog("Mismatching asins: bookId (" + bookId + ") vs asinFromDom (" + asinFromDom + "). Aborting.");

    // We end this sync, and hope if there's another thread running (which caused this bug) that
    // it can figure stuff out on its own...
    onDoneSync();
    return;
  }

  window.currentBookTitle = bookData[bookId].title;

  var highlightElements = $("#kp-notebook-annotations", el).children();
  var highlightTextEl, locationEl, location;
  var highlightCount = 0;

  highlightElements.each(function (index, highlightEl) {
    highlightTextEl = highlightEl.querySelector("#highlight");
    locationEl = highlightEl.querySelector("#kp-annotation-location");
    if (!locationEl || !highlightTextEl) {
      return; // skip the current element if it's not a highlight
    }
    highlightCount += 1;
    location = locationEl.value;
    location += "_" + highlightCount;
    var highlightColor = $('#annotationHighlightHeader', highlightEl).text().split(" ")[0].trim().toLowerCase()

    var highlightNote = highlightEl.querySelector("#note").innerText || null;
    if (highlightNote) {
      // Fix highlightNote in weird edgecase
      highlightEl.querySelector("#note").innerHTML = DOMPurify.sanitize(highlightEl.querySelector("#note").innerHTML.replace(/<br>/mgi, "\n"));
      highlightNote = highlightEl.querySelector("#note").innerText || null;
    }

    bookData[bookId].quotes[location] = {
      text: highlightTextEl.textContent.trim(),
      note: highlightNote,
      color: highlightColor,
    };
  });

  console.log("Pulled all " + Object.keys(bookData[bookId].quotes).length + " highlights for " + bookData[bookId].title)

  var unchangedBooksCutOff = 3

  getRkCookies(function (cookies) {
    if (window.bookCounts) {
      var onLastSync = window.bookCounts[bookId];

      var numNotes = Object.values(bookData[bookId].quotes).filter(function (q) {
        return q.note !== null;
      }).length;
      var numHighlights = Object.values(bookData[bookId].quotes).length;

      if (onLastSync && onLastSync.highlights === numHighlights) { // && onLastSync.notes === numNotes) {
        // If this book hasn't updated highlights, update the unchangedCount
        window.unchangedCount++;
        console.log("unchangedCount: " + window.unchangedCount);
      } else {
        // console.log("Found mismatch: cookies say " + (onLastSync && onLastSync.highlights) + " vs our " + numHighlights);
        // If this book DID have updates, set the unchangedCount back to 0
        window.unchangedCount = 0;
      }

      if (unchangedCount === unchangedBooksCutOff) {
        // If 3 books in a row haven't changed, set this book to be
        // lastBook so that we exit early and save a redundant resync
        bookData[bookId].lastBook = true;
      }
    }
    sendBookData(bookData, cookies, bookData[bookId].lastBook);
  }, true);

}

function pullBookPages(pageToken, contentLimitState, isRetry) {
  var isFirstRequest = !pageToken && !contentLimitState;
  // TODO: use current bookid instead of hardcoding
  var url = 'https://read.amazon.co.jp/notebook?asin=' + window.currentBookId;
  if (isFirstRequest) {
    // set the url to its regular state if we are on the first page
    url += '&contentLimitState=&';
  } else {
    url += '&token=' + pageToken +
        '&contentLimitState=' + contentLimitState + '&';
  }

  getRequest(url).then(function (html) {
    var el = document.createElement('html');
    el.innerHTML = DOMPurify.sanitize(html);
    var nextPageToken = $(".kp-notebook-annotations-next-page-start", el).val();
    var nextContentLimitState = $(".kp-notebook-content-limit-state", el).val();

    if (isFirstRequest) {
      window.currentBookEl = document.createElement('html');
      window.currentBookEl.innerHTML = DOMPurify.sanitize(html);
      ;
    } else {
      $("#kp-notebook-annotations", window.currentBookEl).append(DOMPurify.sanitize(el.innerHTML));
    }

    if (nextPageToken) {
      return pullBookPages(nextPageToken, nextContentLimitState);
    } else {
      return onDonePullingBook();
    }
  }).catch(err => {
    if (isRetry) {
      // skip to the next book
      // TODO: there's still an edge case here where if this is the last book,
      // we won't send a book w/ the lastBook flag and thus won't create a resync
      sendLog("Failed twice fetch highlights for " + window.currentBookId + " ... SKIPPING book");
      pullNextBook();
    } else {
      // retry all failed requests once
      sendLog("First failure to fetch highlights for " + window.currentBookId + " ... trying again");
      pullBookPages(pageToken, contentLimitState, true)
    }
  });
}

function pullNextBook() {
  window.currentBookIndex += 1;
  if (this.currentBookIndex >= this.allBookIds.length) {
    console.log("Done from exhausting entire sidebar, finishing.");
    window.currentBookIndex -= 1; // just to clean up logging of num books synced
    onDoneSync();
    return;
  }

  window.currentBookId = window.allBookIds[window.currentBookIndex];
  window.currentBookEl = null;

  console.log("Starting to pull next book: " + window.currentBookId);

  pullBookPages();
}


function newPullRemainingBookIds() {
  // legacy code
  function parseCookieString(cookieString, name) {
    var value = "; " + cookieString;
    var parts = value.split("; " + name + "=");
    if (parts.length == 2) return parts.pop().split(";").shift();
  }

  function cloudReaderFetch(url, extraHeaders) {
    var commonHeaders = {
      "accept": "application/json, text/javascript, */*; q=0.01",
      "accept-language": "en-US,en;q=0.9,ru;q=0.8",
      "cache-control": "no-cache",
      "pragma": "no-cache",
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-origin",
      "x-requested-with": "XMLHttpRequest",
    }

    return fetch(url, {
      "headers": $.extend({}, commonHeaders, extraHeaders),
      "credentials": "include",
      "referrer": "https://read.amazon.co.jp/",
      "referrerPolicy": "no-referrer-when-downgrade",
      "body": null,
      "method": "GET",
      "mode": "cors"
    }).then(function (r) {
      return r.json()
    });
  }

  cloudReaderFetch(
      "https://read.amazon.co.jp/service/web/register/getDeviceToken?serialNumber=A2CTZ977SKFQZY&deviceType=A2CTZ977SKFQZY",
      {"x-amzn-sessionid": parseCookieString(window.azCookie, "session-id")}
  ).then(function (resp1) {

    cloudReaderFetch(
        "https://read.amazon.co.jp/service/web/reader/getPFM",
        {"x-adp-session-token": resp1["deviceSessionToken"],}
    ).then(function (resp2) {

      cloudReaderFetch(
          "https://read.amazon.co.jp/service/web/reader/getOwnedContent?reason=Registration",
          {"x-adp-session-token": resp1["deviceSessionToken"],}
      ).then(function (data) {

        Object.values(data.asinsToAdd).filter(function (b) {
          return b.contentType === "EBOK" && !window.allBookIds.includes(b.asin)
        }).forEach(function (b) {
          window.allBookIds.push(b.asin);
          window.allBookDates[b.asin] = b.purchaseDate;
        });

        getRkCookies(function (cookies) {
          postRequest('/api/save_kindle_book_list/', {
            accessToken: cookies.accessToken,
            bookList: data.asinsToAdd
          }, function () {
          });
        });
      });
    });
  });
}

function pullRemainingBookIds(bookIdsToken) {
  if (!bookIdsToken) {
    console.log("Pulled all book Ids from sidebar");
    return;
  }

  getRequest('https://read.amazon.co.jp/notebook?library=list&token=' + bookIdsToken).then(function (html) {
    var el = document.createElement('html');
    el.innerHTML = DOMPurify.sanitize(html);

    // add these new book ids to the end of our existing ones
    var newBookIds = $(".kp-notebook-library-each-book", el).map(function (b) {
      return this.id;
    }).get();
    window.allBookIds.push.apply(window.allBookIds, newBookIds);

    $("[id^=kp-notebook-annotated-date-]", el).each(function (b) {
      window.allBookDates[this.id.replace("kp-notebook-annotated-date-", "")] = this.value;
    });

    // pull potentially more book ids
    var nextBookIdsToken = $('.kp-notebook-library-next-page-start', el).val();
    pullRemainingBookIds(nextBookIdsToken);
  });
}

function startSync() {
  if (window.startedSyncing && window.startedSyncing > Date.now() - 27 * 60 * 1000 && !window.isForcedSync) {
    // if we're currently syncing, or were mid-syncing less than half an hour ago, don't try again
    sendLog("Sync was already started (and unfinished) in past hour), returning early.");
    return;
  }

  sendLog("Starting sync for " + (window.cookz ? window.cookz.userFirstName : 'unknown'));

  window.requestHeaders = {
    'Connection': 'keep-alive',
    'Pragma': 'no-cache',
    'Cache-Control': 'no-cache',
    'Upgrade-Insecure-Requests': '1',
    'User-Agent': navigator.userAgent,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8',
    'Accept-Encoding': 'gzip, deflate, br',
    'Accept-Language': 'en-US,en;q=0.9,ru;q=0.8,el;q=0.7',
  };

  // Global variables used in sync:
  window.allBookIds = null;
  window.allBookDates = null;
  window.currentBookIndex = null;
  window.currentBookEl = null;
  window.currentBookId = null;
  window.currentBookTitle = null;
  window.unchangedCount = 0;
  window.startedSyncing = Date.now();
  window.doneSyncing = false;
  window.syncedBookHashes = [];

  // plus also:
  // window.bookCounts, window.isForcedSync,
  // window.azCookie, window.syncAfterTime
  // set after extension_check

  let lastHashesCleanupDate = window.localStorage.getItem('lastHashesCleanupDate') || 0

  if (Date.now() - Number(lastHashesCleanupDate) > 2 * 24 * 3600 * 1000) { // clear localStorage every 2 days
    window.localStorage.removeItem("syncedBookHashes")
    setLocalStorageKey('lastHashesCleanupDate', Date.now());
  }

  let alreadySyncedBooks = window.localStorage.getItem('syncedBookHashes') || "[]"
  window.syncedBookHashes = JSON.parse(alreadySyncedBooks)

  var syncWindow = 25 * 60 * 60 * 1000  // 25 hours

  getRequest('https://read.amazon.co.jp/notebook').then(function (html) {
    var el = document.createElement('html');
    el.innerHTML = DOMPurify.sanitize(html);

    if (isMismatchedAmazonAccount(el)) {
      return;
    }

    window.allBookIds = $(".kp-notebook-library-each-book", el).map(function (b) {
      return this.id;
    }).get();

    window.allBookDates = {}
    $("[id^=kp-notebook-annotated-date-]", el).each(function (b) {
      window.allBookDates[this.id.replace("kp-notebook-annotated-date-", "")] = this.value;
    });

    var lastBook = $(".kp-notebook-library-each-book", el)[window.allBookIds.length - 1];
    var lastBookTime = Date.parse($(lastBook).find("input").val());

    if (window.syncAfterTime !== 0 && lastBookTime < window.syncAfterTime && !window.isForcedSync) {
      // Filter out books that we saw in our previous syncs to hopefully speed this all up
      window.allBookIds = window.allBookIds.filter(function (bookId) {
        return Date.parse(window.allBookDates[bookId]) > window.syncAfterTime - syncWindow;
      });
      console.log("Filtered out books that we saw during the last sync. Down to " + window.allBookIds.length);
    } else {
      var nextBookIdsToken = $('.kp-notebook-library-next-page-start', el).val();
      pullRemainingBookIds(nextBookIdsToken);
    }

    window.currentBookIndex = -1;
    window.currentBookEl = null;
    pullNextBook();

  }).catch(function (error) {
    // TODO: raise rollbar here if this isn't the usual logged out error
    onInitialRequestError(error);
    window.startedSyncing = null;
    window.doneSyncing = true;
    window.allBookIds = null;
    return;
  });
}

function forceStartSync(azCookie) {
  window.uniqueSyncId = Math.random().toString(36).substring(2, 15);
  window.isForcedSync = true;

  getRkCookies(function (cookies) {
    postRequest('/api/extension_check/', {
      force: true,
      accessToken: cookies.accessToken,
      uniqueSyncId: window.uniqueSyncId
    }, function (resp) {
      window.bookCounts = JSON.parse(resp.bookCounts);
      window.syncAfterTime = resp.syncAfterTime * 1000;
      window.azCookie = azCookie; // use the one sent from the DOM

      getRkCookies(function () {
        setTimeout(startSync, 100);
      }, true);
    });
  });
}

function checkAndMaybeStartBackgroundSync() {
  console.log("Woke up to check for sync at " + Date.now());
  window.uniqueSyncId = Math.random().toString(36).substring(2, 15);

  getRkCookies(function (cookies) {

    postRequest('/api/extension_check/', {
          accessToken: cookies.accessToken,
          uniqueSyncId: window.uniqueSyncId
        }, function (resp) {
          if (resp.status === "sync") {
            console.log("Backend check said to sync! " + cookies.userFirstName)
            window.bookCounts = JSON.parse(resp.bookCounts);
            window.syncAfterTime = resp.syncAfterTime * 1000;
            window.azCookie = resp.azCookie;
            window.isForcedSync = false;

            // re-parse our cookies just in case extension_check set some, then START OUR SYNC
            // (for some reason rollbar wont pick up errors unless we use a setTimeout here, lol)
            getRkCookies(function () {
              setTimeout(startSync, 100);
            }, true);
          } else if (resp.status === "skip") {
            console.log("skipping");
          } else if (resp.status === "invalidToken") {
            console.log("invalidToken");
            // if we don't have the accessToken cookie, maybe it'll be stored in storage?
            // send that over
            if (chrome && chrome.storage && chrome.storage.local) {
              chrome.storage.local.get("rkCookies", function (storageCookies) {
                sendLog("got invalidToken response from extension_check, here are the storageCookies: " + JSON.stringify(storageCookies));
              });
            }
          }
        }.bind(this),
        function (resp) {
          ;// TODO: what to do on web request error"?}
        }.bind(this)
    );
  });
}

// end shared code here: ----------------------------------------------------


function onInstallProcess() {
  // don't do the annoying sync start on-install locally by default
  // if (BASE_URL === "https://local.readwise.io:8000") {
  //   return;
  // }

  chrome.tabs.create({url: BASE_URL + "/kindle_welcome_start"});

  // Close the tab that opened the extension installation; it is no longer needed
  chrome.tabs.query({url: BASE_URL + '/welcome/start*'}, function (tabs) {
    if (tabs.length > 0) {
      chrome.tabs.remove(tabs[0].id);
    }
  });
  chrome.tabs.query({url: BASE_URL + '/welcome/sync*'}, function (tabs) {
    if (tabs.length > 0) {
      chrome.tabs.remove(tabs[0].id);
    }
  });
}

chrome.alarms.onAlarm.addListener(function (alarm) {
  console.log(alarm)

  if (alarm.name === "checkSync") {
    checkAndMaybeStartBackgroundSync();
  }
});


function setupAlarms() {
  chrome.alarms.clear("checkSync", function () {
    var firstSyncTimeout;
    if (BASE_URL.indexOf("local") !== -1) {
      // locally, start the first sync immediately
      firstSyncTimeout = 8000;
    } else {
      // in prod, dont try a background sync until an hour after first installation
      firstSyncTimeout = 60 * 60 * 1000;
    }

    chrome.alarms.create("checkSync", {periodInMinutes: 30, when: Date.now() + firstSyncTimeout});
  });

}

chrome.runtime.onInstalled.addListener(function listener(details) {
  if (!/Firefox/i.test(navigator.userAgent)) {
    chrome.tabs.query({url: BASE_URL + '/welcome/start*'}, function (tabs) {

      if (tabs.length > 0) {
        onInstallProcess();
      } else {
        chrome.tabs.query({url: BASE_URL + '/welcome/sync*'}, function (tabs) {
          if (tabs.length > 0) {
            onInstallProcess();
          }
        });
      }
    });
    setupAlarms();
    setUpContextMenu();
    postRequest('/api/extension_login/', {});
  }
});

if (/Firefox/i.test(navigator.userAgent)) {
  setupAlarms();
  setUpContextMenu();
  postRequest('/api/extension_login/', {});
}

chrome.browserAction.onClicked.addListener(function (tab) {
  chrome.tabs.create({url: BASE_URL + "/from_extension"});
});

chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
  if (request.command === "start") {
    if (window.startedSyncing && window.startedSyncing > Date.now() - 10 * 60 * 1000) {
      sendResponse({started: false});
      // don't allow user to start a new sync while one is already running as this causes major race conditions.
      // if we started more than 10mins ago, assume the last sync is over (failed) and try again.
      // this is a faster, necessary check than the one in startSync, which is for autosyncs.
      return;
    }
    // set these here to be extra safe of race conditions:
    window.startedSyncing = Date.now();
    window.doneSyncing = false;

    forceStartSync(request.azCookie);

    sendResponse({started: true});
  } else if (request.command === "status") {
    sendResponse({
      doneSyncing: window.doneSyncing,
      currentBookIndex: window.currentBookIndex,
      numTotalBooks: window.allBookIds && window.allBookIds.length,
      currentBookTitle: window.currentBookTitle,
    })
  } else {
    sendResponse({});
  }
});

function showNotification(shortMessage, longMessage, onClickUrl) {
  if (/Firefox/i.test(navigator.userAgent)) {
    var message = shortMessage + " " + longMessage;

    window.notificationHighlightsUrl = onClickUrl;

    if (!window.hasNotificationClickListener) {
      window.hasNotificationClickListener = true;
      browser.notifications.onClicked.addListener(function () {
        browser.tabs.create({url: window.notificationHighlightsUrl});
      });
    }

    browser.notifications.create({
      "type": "basic",
      iconUrl: 'icons/icon48.png',
      title: "Readwise",
      message: message
    });
    browser.notifications.onClicked.removeListener(window.notificationListener);
  } else {
    var notification = new Notification(shortMessage, {
      icon: 'icons/icon48.png',
      body: longMessage,
    });
    notification.onclick = function () {
      window.open(onClickUrl, '_blank');
    }
  }
}


// The onClicked callback function.
function onContextMenuClick(info, tab) {
  console.log("onContextMenuClick")
  getRkCookies(function (cookies) {
    $.ajax({
      url: BASE_URL + '/api/v2/highlights/',
      type: 'POST',
      contentType: 'application/json',
      beforeSend: function (xhr) {
        xhr.setRequestHeader('Authorization', 'Token ' + cookies.accessToken);
      },
      data: JSON.stringify({
        'highlights': [{
          'text': info['selectionText'],
          'title': tab['title'],
          'url': (info['pageUrl'].indexOf("chrome-extension://") !== -1 && info['srcUrl']) ? info['srcUrl'] : info['pageUrl'],
          'source_type': 'web_clipper',
        },],
        'isWebClipper': true,
      }),
      success: function (resp) {
        showNotification("Highlight saved to your library ✨", "", resp[0].highlights_url);
      },
      error: function () {
        showNotification("❌ Failed to save highlight.", "Are you logged out? Click here to login.", "https://readwise.io/accounts/login");
      },
    });
  });
};

function listenToContextMenuClicks() {
  if (chrome.contextMenus && chrome.contextMenus.onClicked) {
    if (chrome.contextMenus.onClicked.hasListeners && chrome.contextMenus.onClicked.hasListeners()) {
      return;
    }

    console.log("setting up oncontextmenuclicks");
    chrome.contextMenus.onClicked.addListener(onContextMenuClick);
  }
}

function setUpContextMenu() {
  console.log("setUpContextMenu")
  var context = "selection"
  var title = "Save Highlight to Readwise";

  if (chrome.contextMenus) {
    var id = chrome.contextMenus.create({
      "title": title, "contexts": [context],
      "id": "context" + context
    });
    console.log("'" + context + "' item:" + id);
    listenToContextMenuClicks();
  }

  postRequest('/api/extension_login/', {});
}

chrome.runtime.onStartup.addListener(setUpContextMenu);

// We have to re-set this listener every single time the background page "wakes up"
// as chrome kills it often for non-persisten background pages
// For more deets, see: https://stackoverflow.com/a/27251743/1522443
listenToContextMenuClicks();
