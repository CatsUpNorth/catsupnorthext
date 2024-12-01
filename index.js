/* Business logic should live in app.js. Use this script to add listeners and handle messages and then call app methods. */

// TODO:

// Bugs
// [ ] Timezone issue with the chat timestamps.
// [ ] Top chats have doubled-up reactions.
// [ ] Requesting payout removes the name?

/* Listeners (add after doc ready) */
let app = null,
	lastUrlLoaded = null,
	urlMetaData = null,
	traceAll = true, // set to true in console to log all method calls. Only works if traceAllMethodCalls is uncommented.
	urlMetaDataFrame = {
		title: null, 
		description: null, 
		author: null, 
		date: null, 
		image: null, 
		language: null
	};

// For debugging only. 
// Comment out the invocation of this function in prod.
function traceAllMethodCalls(targetClass) {
    // Get all properties of the class, including methods.
	const ignoredMethods = [
		'constructor',			// Not sure if I should override this, but it's not likely to be an issue.
		'heroicon',				// Fetches icon SVG, not likely to be an issue.
		'getReplyToID', 		// Called in every poll loop.
		'getCrossPostID',		// Called in every poll loop.
		'getCurrentThreadID'	// Called in every poll loop.
	];
    const methodNames = Object.getOwnPropertyNames(targetClass.prototype)
        .filter((prop) => typeof targetClass.prototype[prop] === 'function' && ignoredMethods.indexOf(prop) < 0);

    // Override each method
    for (const method of methodNames) {
        const originalMethod = targetClass.prototype[method];

        targetClass.prototype[method] = function (...args) {
            if(traceAll) console.trace(`Method called: ${method}, Arguments:`, args);
            return originalMethod.apply(this, args); // Call the original method
        };
    }
}
// COMMENT THIS OUT IN PROD!
// traceAllMethodCalls(AppState);

function scrapeURL(url){
	if(!url) return;
	if(urlMetaData && urlMetaData?.url === url) return;
	urlMetaData = { url: url, title: null, description: null, author: null, favicon: null, date: null, image: null, language: null };

	// Get the title and description of the user's current tab.
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (chrome.runtime.lastError || !tabs.length) return;
        const tab = tabs[0]; // Get the active tab
		if(tab?.url !== url) return;
		const bannedURLs = ['chrome://', 'file://', 'brave://', 'opera://', 'vivaldi://', 'edge://', 'about:', 'chrome-extension://', 'moz-extension://'];
		if(bannedURLs.some(banned => url.startsWith(banned))) return;
		// Execute a custom script on the page to scrape the title, descript, and image.
		chrome.scripting.executeScript({
			target: {tabId: tab.id},
			function: () => {
				var frame = {
					title: // title of article or page
						(document?.title || '').trim() || 
						document.querySelector('title')?.innerText || 
						document.querySelector('h1')?.innerText || 
						document.querySelector('h2')?.innerText || 
						document.querySelector('h3')?.innerText || 
						document.querySelector('h4')?.innerText || 
						document.querySelector('h5')?.innerText || 
						document.querySelector('h6')?.innerText || 
						document.querySelector('meta[name="title"]')?.content || 
						document.querySelector('meta[property="title"]')?.content || 
						document.querySelector('meta[name="og:title"]')?.content || 
						document.querySelector('meta[property="og:title"]')?.content || 
						document.querySelector('meta[name="twitter:title"]')?.content || 
						document.querySelector('meta[property="twitter:title"]')?.content,
					description: // byline, description, summary, etc.
						document.querySelector('meta[name="description"]')?.content || 
						document.querySelector('meta[name="og:description"]')?.content || 
						document.querySelector('meta[name="og:image"]')?.content || 
						document.querySelector('meta[name="og:title"]')?.content || 
						document.querySelector('meta[name="twitter:description"]')?.content || 
						document.querySelector('meta[name="twitter:image"]')?.content || 
						document.querySelector('meta[name="twitter:title"]')?.content || 
						document.querySelector('meta[property="og:description"]')?.content || 
						document.querySelector('meta[property="og:title"]')?.content || 
						document.querySelector('meta[property="og:image"]')?.content || 
						document.querySelector('meta[property="twitter:title"]')?.content || 
						document.querySelector('meta[property="twitter:description"]')?.content || 
						document.querySelector('meta[property="twitter:image"]')?.content,
					author: // article author or creator name
						document.querySelector('meta[name="author"]')?.content || 
						document.querySelector('meta[name="twitter:creator"]')?.content || 
						document.querySelector('meta[name="twitter:site"]')?.content || 
						document.querySelector('meta[property="author"]')?.content || 
						document.querySelector('meta[property="twitter:creator"]')?.content || 
						document.querySelector('meta[property="twitter:site"]')?.content,
					favicon: // page favicon
						document.querySelector('link[rel="icon"]')?.href || 
						document.querySelector('link[rel="shortcut icon"]')?.href || 
						document.querySelector('link[rel="apple-touch-icon"]')?.href || 
						document.querySelector('link[rel="apple-touch-icon-precomposed"]')?.href || 
						document.querySelector('link[rel="mask-icon"]')?.href || 
						document.querySelector('link[rel="fluid-icon"]')?.href || 
						document.querySelector('link[rel="icon"]')?.href,
					date: // date of the article or content
						document.querySelector('meta[name="date"]')?.content || 
						document.querySelector('meta[name="article:published_time"]')?.content || 
						document.querySelector('meta[name="article:modified_time"]')?.content || 
						document.querySelector('meta[name="og:updated_time"]')?.content || 
						document.querySelector('meta[name="twitter:label1"]')?.content || 
						document.querySelector('meta[property="date"]')?.content || 
						document.querySelector('meta[property="article:published_time"]')?.content || 
						document.querySelector('meta[property="article:modified_time"]')?.content || 
						document.querySelector('meta[property="og:updated_time"]')?.content || 
						document.querySelector('meta[property="twitter:label1"]')?.content, 
					image: // main image from article or page
						document.querySelector('meta[name="image"]')?.content || 
						document.querySelector('meta[name="og:image"]')?.content || 
						document.querySelector('meta[name="twitter:image"]')?.content || 
						document.querySelector('meta[property="image"]')?.content || 
						document.querySelector('meta[property="og:image"]')?.content || 
						document.querySelector('meta[property="twitter:image"]')?.content,
					language: // language of the article or page
						document.querySelector('meta[name="language"]')?.content || 
						document.querySelector('meta[name="og:locale"]')?.content || 
						document.querySelector('meta[name="twitter:language"]')?.content || 
						document.querySelector('meta[property="language"]')?.content || 
						document.querySelector('meta[property="og:locale"]')?.content || 
						document.querySelector('meta[property="twitter:language"]')?.content, 
				}

				// special cases
				const url = window.location.href;
				if(url.includes('youtube.com') || url.includes('youtu.be')){ 
					if(!frame.author){
						frame.author = 
							document.querySelector('ytd-channel-name')?.innerText || 
							document.querySelector('yt-formatted-string.ytd-channel-name')?.innerText || 
							document.querySelector('yt-formatted-string.ytd-video-owner-renderer')?.innerText || 
							document.querySelector('yt-formatted-string.ytd-channel-name')?.innerText || 
							document.querySelector('yt-formatted-string.ytd-video-owner-renderer')?.innerText;
					}
					if(!frame.date){
						frame.date = 
							document.querySelector('ytd-video-primary-info-renderer')?.innerText || 
							document.querySelector('yt-formatted-string.ytd-video-primary-info-renderer')?.innerText || 
							document.querySelector('yt-formatted-string.ytd-video-primary-info-renderer')?.innerText || 
							document.querySelector('yt-formatted-string.ytd-video-primary-info-renderer')?.innerText;
					}
				}
				if(url.includes('x.com') || url.includes('twitter.com')){
					frame.image = 
						document.querySelector('meta[name="twitter:image"]')?.content || 
						document.querySelector('meta[property="twitter:image"]')?.content || 
						document.querySelector('meta[name="og:image"]')?.content || 
						document.querySelector('meta[property="og:image"]')?.content || 
						document.querySelector('meta[name="image"]')?.content || 
						document.querySelector('meta[property="image"]')?.content;
				}

				// Clean up the data
				if(frame.title && frame.title.length > 255) frame.title = frame.title.substring(0, 255);
				if(frame.description && frame.description.length > 255) frame.description = frame.description.substring(0, 255);
				if(frame.author && frame.author.length > 255) frame.author = frame.author.substring(0, 255);
				if(frame.date && frame.date.length > 255) frame.date = frame.date.substring(0, 255);
				if(frame.language && frame.language.length > 255) frame.language = frame.language.substring(0, 255);

				return frame;
			}
		}, (result) => {
			if(chrome.runtime.lastError) return;
			if(!result || !result[0]) return;
			const saveURL 	= urlMetaData.url;
			urlMetaData 	= JSON.parse(JSON.stringify(urlMetaDataFrame)); // reset the urlMetaData object.
			urlMetaData.url = saveURL;
			Object.assign(urlMetaData, ( result[0]?.result || {} )); // merge the results into the urlMetaData object.
			buildMetaDataForm();
		});
	});
}

// listen for messages from the user's current tab
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
	if(request.action === 'set_metadata_image'){
		const url = request.url;
		urlMetaData.image = url;
		buildMetaDataForm();
	}
});

function updateURLTable(){
	$('.url_mod_table').each(function(){
		const base_td 	= $(this).find('.base_url_td');
		const base_url 	= base_td.attr('data-base-url');
		var query_parts = [];
		$(this).find('.q_tr').each(function(){
			if($(this).hasClass('disabled')) return '';
			const q_key = $(this).find('.query_key').text();
			const q_val = $(this).find('.query_val').text();
			if(!q_key || !q_val) return '';
			query_parts.push(`${q_key}=${q_val}`);
		});
		query_parts 	= query_parts.length? query_parts.join('&') : '';
		const q_mark	= query_parts.length? '?': '';
		const new_url 	= `${base_url}${q_mark}${query_parts}`.trim();
		base_td.attr('data-url', new_url).empty();
		if(new_url == app.getCurrentURL()){
			base_td.append(`<span class="faded">${new_url}</span>`);
		}else{
			base_td.append(`<span class="success">GO</span>&nbsp;<a href="${new_url}" target="_blank">${new_url}</a>`);
		}
	});
}

function buildMetaDataForm(){
	$('#metadata_form').empty();
	urlMetaData = urlMetaData || {};
	for(const key in urlMetaData){
		const val 	= urlMetaData[key];
		const lbl 	= $(`<span class="chat_info">page ${key}</span>`);
		var inp 	= '';
		if(['favicon','date','language'].indexOf(key) > -1) continue; // skip the favicon
		if(key == 'url'){
			if(val.indexOf('?') > -1){
				// split the url
				const url_split 	= val.split('?');
				const base_url 		= url_split[0];
				const query 		= url_split[1];
				inp 				= $(`<table class="url_mod_table"><tbody><tr><td data-base-url=${base_url} data-url="${val}" class="base_url_td" colspan="3"></td></tr></tbody></table>`);
				const query_params 	= query.split('&');
				for(const param of query_params){
					const param_split = param.split('=');
					const q_key 	= param_split[0];
					const q_val 	= param_split[1];
					const x_icon 	= app.heroicon('trash-solid').outerHTML || '❌';
					const q_kill	= $(`<a href="#" style="font-size:1.1em;" data-query-key="${q_key}" class="error pull-right">${x_icon}</a>`);
					q_kill.on('click', function(){
						const q_key = $(this).attr('data-query-key');
						const q_tr  = $(`.q_tr[data-query-key="${q_key}"]`);
						if(q_tr.hasClass('disabled')){
							q_tr.removeClass('disabled');
						}else{
							q_tr.addClass('disabled');
						}
						updateURLTable();
					});
					const qtr = $(`<tr class="q_tr" data-query-key="${q_key}" style="text-align:right;opacity:0.6;"><td class="query_key">${q_key}</td><td class="query_val" style="text-align:left;">${q_val}</td></tr>`)
					qtr.find('.query_val').append(q_kill);
					inp.find('tbody').append(qtr);
				}
				inp.find('tbody').append(`<tr>
					<td class="chat_info faded" style="text-align:right;opacity:0.6;" colspan="3">Remove trackers ${app.heroicon('arrow-turn-right-up').outerHTML}</td>
				</tr>`);
			}else{
				inp = `<span class="chat_info success">${val}</span><br>`;
			}
		}else if(key == 'image'){
			lbl.append('&nbsp;|&nbsp;Drag an image here.');
			inp = $(`<div class="img_drop_zone faint-border"><img class="metadata_img" src="${( val? val: 'https://catsupnorth.com/static/logo.png')}" style="display:inline-block;max-height:6em;height:6em;min-height:6em;min-width:6em;" alt="Drag an image here"></div>`);
		}else if(key == 'description'){
			inp = $(`<textarea data-medadata-key="${key}">${( val? val: '' )}</textarea>`);
			inp.on('keyup', function(){
				const key = $(this).attr('data-medadata-key');
				urlMetaData[key] = $(this).val();
			});
		}else{
			inp = $(`<input type="text" data-medadata-key="${key}" value="${( val? val: '' )}">`);
			inp.on('keyup', function(){
				const key = $(this).attr('data-medadata-key');
				urlMetaData[key] = $(this).val();
			});
		}
		$('#metadata_form').append(lbl,'<br>',inp,'<br>');
		if(key == 'image'){
			inp.off().on('dragover', function (event) {
				event.preventDefault();
				$(this).removeClass('faint-border').addClass('success-border');
			}).on('dragleave', function () {
				$(this).removeClass('success-border').addClass('faint-border');
			}).on('drop', function (event) {
				event.preventDefault();
			
				// Retrieve the dragged content
				const draggedElement = event.originalEvent.dataTransfer.getData('text/html');
				const tempDiv = $('<div>').html(draggedElement);
				var draggedImage = tempDiv.find('img');
			
				if (draggedImage.length) {
					draggedImage = draggedImage.first();
					$(this).find('.metadata_img').attr('src', draggedImage.attr('src')); // Update the image source
					urlMetaData.image = draggedImage.attr('src');
				} else {
					alert('Please drag an image!');
				}
			});
		}
	}
	updateURLTable();
};
	
$('document').ready(function(){

	/* Initialize app state */
	app = new AppState();
	$('#version_str').text(app.version);
	$('#nav_opener').on('click', function(){ 
		if(app) app.getThreads(); // turn off the chat polling.
		$('#nav_dropdown').fadeToggle(200); 
	});
	$('#nav-buy').on('click', function(){ app.buildWalletForm(); });
	$('#nav-follows').on('click', function(){ app.buildFollowList(); });
	$('#nav-close').on('click', function(){
		$('#nav_dropdown').hide(300,function(){
			$('#form_container').empty().hide();
			$('#nav-close').hide();
		});
	});
	$('#gui').on('scroll', function(){
		const isScrolledToBottom = $(this).scrollTop() + $(this).innerHeight() >= $(this)[0].scrollHeight - 10;
		if(isScrolledToBottom){
			app.clearNewMessages();
			app.skipAutoScroll = false;
			$('#scroll_to_bottom_link').addClass('faded');
		}else{
			app.skipAutoScroll = true;
			$('#scroll_to_bottom_link').removeClass('faded');
		}
	});
	$('#scroll_to_bottom_link').on('click', event => {
		event.preventDefault();
		app.scrollDown();
	});
	$('#chat_input').on('keyup', function(event){
		const v_len = $(this).val().length;
		if(v_len > 0){
			const threadId = app.getCurrentThreadID();
			if(threadId){
				$('#spend_container').slideDown(200); // Allow user to super chat
			}else{
				scrapeURL(app.getCurrentURL());
				$('#create_thread_options').slideDown(200); // Show the password input for creating a password-protected thread.
			}
			$('#send_link').fadeIn(200);
		}else{
			$('#create_thread_options').add('#spend_container').slideUp(200,function(){
				$('#spend_input').val('').trigger('keyup');
				$('#metadata_form').empty();
				urlMetaData = null;
			});
			$('#send_link').fadeOut(200);
		}
		if(event.key === 'Enter'){
			event.preventDefault();
			if(event.ctrlKey && app.getCurrentThreadID()){ // Users cannot send money when creating a thread (currentThreadID will return null if not inside thread).
				$('#send_money_btn').trigger('click');
			}else{
				$('#send_link').trigger('click');
			}
		}
		const bal = app.getSelectedWalletBalance();
		$('#sats_max').empty().append(`Max:&nbsp;${bal}`);
	});
	$('#spend_input').on('keyup', function(event){
		event.preventDefault();
		const v 	= isNaN($(this).val()*1)? 0: $(this).val()*1;
		const sats 	= app.fiatToSatoshi(v);
		const bal 	= app.getSelectedWalletBalance();
		if(sats > bal){
			$('#spend_sat').add('#spend_input').addClass('error-border')
			$('#spend_sat').add('#spend_input').add('#spend_desc').addClass('error');
		}else{
			$('#spend_sat').add('#spend_input').removeClass('error-border')
			$('#spend_sat').add('#spend_input').add('#spend_desc').removeClass('error');
		}
		if(sats < 1){ // user does not want to super chat.
			$('#spend_sat').val(''); // Server will understand this as a non-super chat.
			$('#spend_desc').empty();
			return;
		}
		$('#spend_sat').val(sats);
		const star 		= app.heroicon('star-solid').outerHTML || '⭐';
		$('#spend_desc').empty().append(`${star} ${app.fiatStrFormatted(v)} ${star} ${app.satoshiToCryptoStr(sats)} ${star}`);
		if(event.key === 'Enter') $('#send_link').trigger('click');
	});
	$('#spend_sat').on('keyup', function(event){
		event.preventDefault();
		const sats	= isNaN($(this).val()*1)? 0: $(this).val()*1;
		const bal 	= app.getSelectedWalletBalance();
		if(sats > bal){
			$('#spend_sat').add('#spend_input').addClass('error-border')
			$('#spend_sat').add('#spend_input').add('#spend_desc').addClass('error');
		}else{
			$('#spend_sat').add('#spend_input').removeClass('error-border')
			$('#spend_sat').add('#spend_input').add('#spend_desc').removeClass('error');
		}
		if(sats < 1){ // user does not want to super chat.
			$('#spend_input').val(''); // Server will understand this as a non-super chat.
			$('#spend_desc').empty();
			return;
		}
		$('#spend_input').val(app.satoshiToFiat(sats));
		const star 		= app.heroicon('star-solid').outerHTML || '⭐';
		$('#spend_desc').empty().append(`${star} ${app.satoshiToFiatStr(sats)} ${star} ${app.satoshiToCryptoStr(sats)} ${star}`);
		if(event.key === 'Enter') $('#send_link').trigger('click');
	});
	$('#sats_max').on('click', function(){
		const bal = app.getSelectedWalletBalance();
		$('#spend_sat').val(bal)
		$('#spend_sat').trigger('keyup');
	});
	$('#send_link').on('click',function(){
		const wallet_id 	= app.getSelectedWalletID();
		const content 		= app.readAndClearChatInput();
		const thread_id		= app.getCurrentThreadID();

		// Make sure the user is not trying to cross-post when a thread is not selected.
		const xpost_check	= app.getCrossPostID();
		if(xpost_check && !thread_id){
			app.feed('You cannot cross-post outside of a thread.', true);
			return;
		}

		const top_chat_id	= app.getTopChatID();
		const reply_to_id 	= app.getReplyToIDAndClear();
		const xpost_id		= app.getCrossPostIDAndClear();
		var use_reply_to	= reply_to_id? reply_to_id: top_chat_id;
			use_reply_to	= xpost_id? xpost_id: use_reply_to;
		const spend 		= !isNaN($('#spend_sat').val()*1)? $('#spend_sat').val()*1: 0;
		const bal 			= app.getSelectedWalletBalance();
		if(spend > bal){
			app.feed('Insufficient Funds.', true);
			return;
		}
		const password		= thread_id? null: $('#password_init').val().trim(); // cached passwords used for commenting in possword-protected threads.
		const channel		= $('#thread_channel').val(); // TODO: Need to implement this
		if(thread_id){
			app.sendChat(wallet_id, content, use_reply_to, thread_id, spend, password, channel);
		}else{
			app.updateCurrentMetadata(urlMetaData); // Used to tell the server to update the metadata for the new thread.
			app.createThread(wallet_id, content, password, channel);
		}
		$('#create_thread_options').slideUp(200,function(){
			$('#metadata_form').empty();
		});
		$('#spend_container').slideUp(200,function(){
			$('#spend_input').val('').trigger('keyup');
		});
	});
	$('#scroll_to_bottom_link').click(event => {
		event.preventDefault();
		app.scrollDown();
	});
	$('#exit_thread').on('click', function(event){
		event.preventDefault();
		app.setCurrentThreadID(null); // should stop the polling
		app.getThreads();
		$('#chat_input').val('').trigger('keyup');
	});
	$('#ext_search').on('keyup', function(){
		const query = $(this).val();
		if (query.length < 3){
			$('.search_hide').removeClass('search_hide');
			return;
		}
		$('.chat').add('.thread').each(function(){
			const chat_text = $(this).text().toLowerCase();
			if(chat_text.includes(query)){
				$(this).removeClass('search_hide');
			}else{
				$(this).addClass('search_hide');
			}
		});
	});

	// polling
	try{
		window.chatInterval = clearInterval(window.chatInterval);
	}catch(e){
		console.error(e);
	}
	window.chatInterval = setInterval(() => {
		$('.loading_dots').each(function(){
			const dots = $(this).text();
			if(dots.length < 3){
				$(this).append('.');
			}else{
				$(this).empty().append('.');
			}
		});
		if(app.midRequest) return;
		const threadId 		= app.getCurrentThreadID();
		const replyToId 	= app.getReplyToID();
		const crossPostId	= app.getCrossPostID();
		var send_verb 		= 'Create Thread';
		if(threadId){
			send_verb = 'Post to Thread ' + threadId;
			if(replyToId){
				send_verb = 'Reply to Chat ' + replyToId;
			}else if(crossPostId){
				send_verb = 'Cross-Post Chat ' + crossPostId;
			}
			app.loadThread();
			$('#create_thread_options').slideUp(200);
			if($('#chat_input').val().length > 0){
				$('#spend_container').slideDown(200);
			}
		}
		$('#send_verb').empty().append(send_verb);
		traceAll = false;
	}, 955);

	
	// Track when the user's current url changes and load threads for the new page (new tab, new page, etc.)
	chrome.webNavigation.onCompleted.addListener((details) => { // Monitor when a user navigates to a new page in the current tab
		if(!app) return; // app is loaded when page ready.
		chrome.tabs.get(details.tabId, (tab) => {
			if (tab && tab.url && tab.url != lastUrlLoaded){
				app.getThreads(tab.url);
				lastUrlLoaded = tab.url;
				urlMetaData = null;
				$('#chat_input').val('').trigger('keyup');
			}
		});
	});
	chrome.tabs.onActivated.addListener((activeInfo) => { // Listen for navigation on current tab
		if(!app) return; // app is loaded when page ready.
		chrome.tabs.get(activeInfo.tabId, (tab) => {
			if (tab && tab.url && tab.url != lastUrlLoaded){
				app.getThreads(tab.url);
				lastUrlLoaded = tab.url;
				urlMetaData = null;
				$('#chat_input').val('').trigger('keyup');
			}
		});
	});
	chrome.tabs.onCreated.addListener((tab) => { // Listen for new tab creation
		if(!app) return; // app is loaded when page ready.
		if (tab && tab.url && tab.url != lastUrlLoaded){
			app.getThreads(tab.url);
			lastUrlLoaded = tab.url;
			urlMetaData = null;
			$('#chat_input').val('').trigger('keyup');
		}
	});
	// Add a listener for sites that use pushState to change the URL without reloading the page.
	chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
		if(!app) return; // app is loaded when page ready.
		chrome.tabs.get(details.tabId, (tab) => {
			if (tab && tab.url && tab.url != lastUrlLoaded){
				app.getThreads(tab.url);
				lastUrlLoaded = tab.url;
				urlMetaData = null;
				$('#chat_input').val('').trigger('keyup');
			}
		});
	});

});