function parseFirstName() {
    var greeting = document.querySelector("a.a-popover-trigger");
    if (!greeting || !greeting.textContent) {
        return "";
    }
    return greeting.textContent.replace("Hello,", "").trim();
}

function loadAllQuotes(){
    this.onFinishedBook = function(bookId, isTimedOut){
        if(bookId !== this.allBookIds[this.bookIndex]){
            return;
        }
        this.observer.disconnect();
        clearTimeout(this.timeout);

        var data = {lastBook: this.bookIndex === this.allBookIds.length - 1, timedOut: isTimedOut};
        document.dispatchEvent(new CustomEvent("loadedBook", {'detail': data}));
        if (isTimedOut) {
            Rollbar.error("Timed out loading highlights for book", {bookId: bookId, numHighlightsShowing: $("#kp-notebook-annotations").children().length})
        }
    }

    this.rkAddNextBook = function(){
        // increment which book we're importing
        this.bookIndex += 1;
        $(".loader-status").html(" Book " + (this.bookIndex + 1) + "/" + this.allBookIds.length);

        // refresh the sidebar list of books in case more books loaded async
        this.allBookIds = $(".kp-notebook-library-each-book").map(function(b){return this.id;}).get()

        if (this.bookIndex == this.allBookIds.length) {
            document.dispatchEvent(new CustomEvent("doneImport", {}));
            return;
        }

        var bookId = this.allBookIds[this.bookIndex];
        var getBookButton = $("#" + bookId).find("span.a-declarative")[0];
        // create an observer instance
        this.observer = new MutationObserver(function(mutations) {
            // highlightsCount is only an integer when the highlights for this book have finished loading
            var highlightsCount = $("#kp-notebook-highlights-count").text();
            console.log(highlightsCount);
            if (highlightsCount && highlightsCount !== "--") {
                // Yay! Done loading highlights.
                this.onFinishedBook(bookId, false);
            }
        }.bind(this));

        // pass in the target node, as well as the this.observer options
        this.observer.observe(document.querySelector("#annotations .a-row"), {childList: true, attributes: true, subtree: true});

        this.timeout = setTimeout(function(){ this.onFinishedBook(bookId, true) }.bind(this), 20 * 1000);
        getBookButton.click();
    }

    this.allBookIds = $(".kp-notebook-library-each-book").map(function(b){return this.id;}).get();

    if (this.allBookIds.length == 0){
        document.dispatchEvent(new CustomEvent("noHighlights", {}));
        return;
    }

    this.bookIndex = -1;

    document.addEventListener("sentQuotes", function(e){
    	this.rkAddNextBook();

    }.bind(this));

    document.addEventListener("earlyClose", function(e){
        $(".loader").hide();
        $(".loader-text").css("color", "lightgreen");
        $(".loader-text").text("Account connected! Sending you back 🙌");
        setTimeout(function(){
            window.close();
        }, 2000);

    }.bind(this));

    this.rkAddNextBook();
}

// Give it a second to ensure the sidebar dom has loaded async
setTimeout(loadAllQuotes, 1000);
