/* App State */
class AppState {
	constructor() {
		this.version			= '1.0.0';
		this.paused 			= false;
		this.convUpdatedAt		= null; // Last time conversion rates were updated in seconds from epoch
		this.state				= {}; // store notifications until users mark read.

		this.modMode			= false; // turns on mod features like universal blur permission. Server will check if wallet is a mod wallet.

		// chat forwarding
		this.forwardedChatID	= null; // chat id to forward users to after visiting the /chat_forwarding page
		this.forwardedThreadID	= null; // thread id to forward users to after visiting the /chat_forwarding page

		this.settingsSchema 	= {};
		this.passCache			= {}; // Password attempts by thread id
		this.contentCacheFC		= null; // Used to save the last chat sent for when users are doing a free chat.
		this.replyToCacheFC		= null; // Used to save the last chat sent for when users are doing a free chat.
		this.threadIdCacheFC	= null; // Used to save the last chat sent for when users are doing a free chat.
		this.newPassCacheFC		= null; // Used to save the last chat sent for when users are doing a free chat.
		this.settingsDefault 	= {
		    server_url:				"https://catsupnorth.com", // fallback server url
			fiat_code:				'USD',
			load_images:			false, // Thread and chat images loaded via Markdown
			hide_free_threads:		false,
			hide_free_chats:		false,
			show_crypto_balance:	false,
			show_sats_balance:		true,
			show_fiat_balance:		true,
			show_conversions:		[ "BTC_USD", "XMR_USD" ],
			blur_setting:			'blur', // show, blur, or hide
			dwell_time_per_dollar:	0, // how long a tip chat stays visible per dollar spent
			font_size:				'0.7em',
		};
        this.settingsSchema 	= {
            server_url:				'string',
            fiat_code:				'string',
			load_images:			'boolean', // Thread and chat images loaded via Markdown
            hide_free_threads:		'boolean',
            hide_free_chats:		'boolean',
			show_crypto_balance:	'boolean',
			show_sats_balance:		'boolean',
			show_fiat_balance:		'boolean',
			show_conversions:		'array',
			blur_setting:			'string',
			dwell_time_per_dollar:	'number',
			font_size:				'string',
        };
		this.settingsDescriptions = {
			server_url:				'The URL of the server to send chats to.',
			fiat_code:				'The fiat currency code to use for conversion rates.',
			load_images:			'Auto-load images in threads and chats. Not recommended.',
			hide_free_threads:		'Hide threads not made using a wallet.',
			hide_free_chats:		'Hide chats not made using a wallet.',
			show_crypto_balance:	'Show the crypto balance of your wallet. Turn off when streaming.',
			show_sats_balance:		'Show the atomic unit balance of your wallet. Turn off when streaming.',
			show_fiat_balance:		'Show the fiat balance in your wallet. Turn off when streaming.',
			show_conversions:		'Which conversion rates to show (must be available from server).',
			blur_setting:			'How to handle blurred content. You can either show them, blur them (you can click to view), or hide them all together.',
			dwell_time_per_dollar:	'How many seconds a chat with tip is highlighted per dollar spent. Set to zero to hide if you are not streaming.',
			font_size:				'General font size of extension text. Some elements may be larger or smaller.',
		};
		this.settingsLimits 	= {
			refresh_threads_microseconds: 	[ 2500, 60000 ], // 2.5 seconds to 60 seconds
			refresh_chat_microseconds: 		[ 550,  5000  ],  // 0.55 seconds to 5 seconds
		};
		this.skipFeed 			= false; // skip feed message if true only once (set back to false just before feed method exits early)
		this.skipAutoScroll 	= false; // skip autoscroll if user is scrolling up in the chat.
		this.currentCaptcha 	= null;
		this.transactionCaptcha	= null; // set to captchaId when user initiates a super chat or a verified username purchase.
		this.followSearch		= null;
		this.followAlias		= null;
		this.unfollowStr		= null;
		this.newMessages 		= 0;
		this.conversionRates 	= [];
		this.midRequest 		= false;
		this.lastThreadLoaded 	= null;
		this.allThreadChatIds 	= [];
		this.currentMetadata 	= {};
		this.threadLocked		= null; // set to id if locked
		this.waitingURL			= null; // used to track real url if thread is locked
		this.currentTree 		= {}; // site level thread map
		this.treeVisibleNodes 	= []; // visible nodes in the tree based un current url.
		for (let key in this.settingsDefault) this.settingsSchema[key] = typeof this.settingsDefault[key];
		this.settingsSchema.server_url = 'string';
		this.loadState();
	}

	startModMode(){ // manually called in the console to enable mod features
		this.modMode = true;
	}

	stopModMode(){ // manually called in the console to disable mod features
		this.modMode = false;
	}

	lockThread(){
		this.threadLocked = this.getCurrentThreadID();
	}

	unlockThread(){
		this.threadLocked = null;
		this.getThreads(this.waitingURL); // refresh threads on current page
		this.waitingURL = null;
	}

	bookmarkThread(thread_id = null, url = null, content = null, author = null){
		try{
			this.state.bookmarks[thread_id] = {
				url:		url,
				content:	content,
				author:		author,
			};
			this.saveState();
		}catch(e){
			console.error(e);
		}
	}

	unbookmarkThread(thread_id = null){
		try{
			delete this.state.bookmarks[thread_id];
			this.saveState();
		}catch(e){
			console.error(e);
		}
	}

	buildBookmarkList(){
		$('#nav_dropdown').slideUp(200); // hide the nav dropdown if open.
		this.setCurrentThreadID(null); // should stop the polling
		$('#exit_thread_container').slideUp(200);
		const exitIcon = this.heroicon('x-mark') || '❌';
		const exitLink = $(`<a href="#" class="exit_to_thread pull-right" id="exit_bookmark_list">${exitIcon} Close</a>`);
		exitLink.on('click', (e) => {
			e.preventDefault();
			this.getThreads();
		});
		$('#gui').empty().append('&nbsp;',exitLink,'<br><br>');
		const bookmarks = this.state?.bookmarks || {};
		if(!bookmarks || Object.keys(bookmarks).length < 1){
			this.feed('No bookmarks found.', false, null, true);
			return;
		}
		for(let thread_id in bookmarks){
			if(!bookmarks[thread_id] || !bookmarks[thread_id].url || bookmarks[thread_id].url.length < 1) continue;
			const bookmark 		= bookmarks[thread_id];
			const url 			= bookmark.url || null;
			const content 		= bookmark.content || null;
			const author 		= bookmark.author || null;
			const link 			= $(`<a href="${url}" data-thread-id="${thread_id}" target="_blank"><strong class="faded">${thread_id}</strong> ${content}</a>`);
			link.on('click', (e) => {
				e.preventDefault();
				const ctarg = $(e.currentTarget);
				const threadId = ctarg.attr('data-thread-id');
				this.forwardedThreadID = threadId;
				// continue with default action of opening the link in a new tab
				window.open(ctarg.attr('href'), '_blank');
			});
			const trash_icon 	= this.heroicon('trash-solid') || '❌';
			const del_link 		= $(`<a href="#" class="pull-right delete_bookmark" data-thread-id="${thread_id}">${trash_icon} Delete</a>`);
			del_link.on('click', (e) => {
				e.preventDefault();
				const ctarg = $(e.currentTarget);
				const threadId = ctarg.attr('data-thread-id');
				this.unbookmarkThread(threadId);
				this.buildBookmarkList();
			});
			const bookmarkContainer = $(`<div class="bookmark_container" data-thread-id="${thread_id}"></div>`);
			bookmarkContainer.append(link, `<br>by ${author}`,del_link,`<br><span class="faded" style="font-style:italic;font-size:0.7em;">${url}</span>`);
			$('#gui').append(bookmarkContainer);
		}

		$('#ext_search').attr('placeholder','Search Bookmarks...');
	}
	
	feed(arg, err = false, cloneBefore = null, replaceGUI = false){
		if(this.skipFeed && !err){ // used when autoloading threads or chats right after user action
			this.skipFeed = false;
			return;
		}
		$('.feed_clone').remove(); // remove any existing clones of the feed message.
		if(err) console.trace(arg);	// for debugging
		$('#feed_error').toggle((err? true: false));
		$('#feed').empty().append((arg.toString() || "&nbsp;"));
		// Check if cloneBefore is a jquery object with length > 0 and then add a clone of #feed before it (remove id first).
		if(cloneBefore && cloneBefore.length > 0){
			const feed_clone = $('#feed').clone().removeAttr('id').addClass('feed_clone');
			feed_clone.prepend('<br><br>').append('<br><br>').css({display:'none', width:'100%', minWidth: '100%'});
			feed_clone.insertBefore(cloneBefore);
			feed_clone.slideDown(200,()=>{
				setTimeout(() => { $('.feed_clone').slideUp(200,function(){ $(this).remove(); }); }, 5000); // The next feed message will remove this junk clone
			});
		}
		if(replaceGUI){
			arg = arg.toString();
			$('#gui').empty().append(`<h1 style="opacity:0.7;padding:10px;font-weight:300;font-style:italic;"><br><br><img style="display:inline-block;height:1em;" src="images/icon-128.png">&nbsp;${arg}</h1>`);
		}
	}

	clearNewMessages(){
		this.newMessages = 0;
		$('.new_msg_indicator').empty();
	}

	_decodeHTMLEntities(text) { // Used to decode HTML entities in chat messages but preserves line breaks.
		text	= (text && typeof text == "string")? text: '';
		text 	= text.replace(/(?:\r\n|\r|\n)/g, '__tmp_br_placeholder__');
		text	= text.replace(/<br>/g, '__tmp_br_placeholder__');
		let el 	= $(`<div>${text}</div>`);
		return el.text().replace(/__tmp_br_placeholder__/g, '\n');
	}

	parseMarkdown(markdown) {
		markdown = typeof markdown == 'string'? markdown: '';
		markdown = this._decodeHTMLEntities(markdown);

		try{

			// Escape HTML special characters
			markdown = markdown
				.replace(/&/g, "&amp;")
				.replace(/</g, "&lt;")
				.replace(/>/g, "&gt;");
			
			// Handle code blocks (```) - Multiline
			markdown = markdown.replace(/```([\s\S]+?)```/g, '<pre><code>$1</code></pre>');
			
			// Handle inline code (`code`)
			markdown = markdown.replace(/`([^`]+)`/g, '<code>$1</code>');
			
			// Convert headings (e.g., # Heading)
			markdown = markdown.replace(/^#{6}\s(.+)/gm, '<h6>$1</h6>')
						   .replace(/^#{5}\s(.+)/gm, '<h5>$1</h5>')
						   .replace(/^#{4}\s(.+)/gm, '<h4>$1</h4>')
						   .replace(/^#{3}\s(.+)/gm, '<h3>$1</h3>')
						   .replace(/^#{2}\s(.+)/gm, '<h2>$1</h2>')
						   .replace(/^#\s(.+)/gm, '<h1>$1</h1>');
			
			// Convert bold (**bold**)
			markdown = markdown.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
			
			// Convert italic (*italic*)
			markdown = markdown.replace(/\*(.*?)\*/g, '<em>$1</em>');
	
			// convert images ![alt](url)
			markdown = markdown.replace(/!\[(.*?)\]\((.*?)\)/g, '<img data-src="$2" src="" alt="$1" style="max-width:100%;">');
			
			// Convert links [text](url)
			markdown = markdown.replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2">$1</a>');
			
			// Convert unordered lists (- item)
			markdown = markdown.replace(/^- (.*)$/gm, '<li>$1</li>');
			markdown = markdown.replace(/(<li>.*<\/li>)/g, '<ul>$1</ul>');
			
			// Convert ordered lists (1. item)
			markdown = markdown.replace(/^\d+\. (.*)$/gm, '<li>$1</li>');
			markdown = markdown.replace(/(<li>.*<\/li>)/g, '<ol>$1</ol>');
			
			// Convert new lines to <br> tags for line breaks
			markdown = markdown.replace(/\n/g, '<br>');
		}catch(e){
			console.error('Error parsing markdown:', e);
		}

		markdown = typeof markdown == 'string'? markdown: '';

		return markdown.split('<br>'); // return array of lines, first line used for preview.
	}

	contentPreview(content, chat_id, thread_id){ // if thread_id is a number, create an open thread link.
		const preview_lim		= 100;
		const markdown_lines 	= this.parseMarkdown(content);
		var first_line 			= this._decodeHTMLEntities(markdown_lines?.[0] || '');
		const first_line_len 	= first_line.trim().length;
		first_line				= first_line_len > preview_lim? first_line.substring(0, preview_lim) + '...': first_line;
		var img_count 			= 0;
		for(var i=0; i<markdown_lines.length; i++){
			const ln = markdown_lines[i];
			if(ln.includes('<img')) img_count++;
		}
		const content_div  		= $(`
			<div class="content_container" data-chat-id="${chat_id}">
				<span class="content_preview">${first_line}</span>
				<div class="markdown_content" style="display:none;">${markdown_lines.join('<br>')}</div>
			</div>`);

		

		if(thread_id){ // div with thread_opener link
			const loadThreadLink 	= $(`<a class="thread_opener" data-thread-id="${thread_id}" data-chat-id="${chat_id}">${first_line} ›</a>`);
			loadThreadLink.on('click', (e) => {
				e.preventDefault();
				if(this.paused) return;
				// Get thread ID from the clicked element
				const ctarg 	= $(e.currentTarget);
				const threadId 	= ctarg.attr('data-thread-id');
				if(ctarg.hasClass('password_required')){
					const existingPassForm = $(`.thread_pass_form[data-thread-id="${threadId}"]`);
					if(existingPassForm.length > 0){ // user decides not to join thread by clicking again
						// remove all existing pass forms
						$('.thread_pass_form').remove();
						return;
					}
					const cachedPass = this.getCachedPass(threadId);
					const cachedPassStr = cachedPass? ` value="${cachedPass}"`: '';
					const passForm = $(
						`<form class="thread_pass_form" data-thread-id="${threadId}" style="display:none;">
							<input type="hidden" name="thread_id" value="${threadId}">
							<input type="password" name="password" placeholder="Thread Password"${cachedPassStr}>
							<input type="submit" value="Login to Thread ${threadId}">
						</form>`
					);
					passForm.on('submit', (e) => {
						e.preventDefault();
						const formData 	= new FormData(e.target);
						const tid_val 	= formData.get('thread_id');
						const pass_val	= this.cachePass(tid_val, formData.get('password'));
						this.loadThread(tid_val, pass_val);
					});
					ctarg.after(passForm);
					passForm.slideDown(200, ()=>{
						passForm.find('input[type="password"]').focus();
					});
				}else{
					this.loadThread(threadId);
				}
			});
			content_div.find('.content_preview').empty().append(loadThreadLink);
		}	

		if(first_line_len > preview_lim || markdown_lines.length > 1 || first_line_len < 1){
			content_div.append('<br>');
			const charCount  	= content.length;
			const expandIcon 	= this.heroicon('chevron-down') || '↓';
			const verb 			= img_count > 0? `img${(img_count  == 1? '': 's')} (${img_count})`: `more (${charCount})`;
			const expandLink 	= $(`<a class="expand_content" data-chat-id="${chat_id}" data-verb="${verb}">${verb} ${expandIcon}</a>`);
			expandLink.on('click', (e) => {
				e.preventDefault();
				const ctarg 		= $(e.currentTarget);
				ctarg.css({opacity:0});
				const chatId 		= ctarg.attr('data-chat-id');
				const contentCont	= $(`.content_container[data-chat-id="${chatId}"]`);
				const contentPrev	= contentCont.find('.content_preview');
				const markdownCont	= contentCont.find('.markdown_content');
				if(markdownCont.is(':visible')){ // if visible, we hide the markdown and show the preview
					const icon = this.heroicon('chevron-down') || '↓';
					const verb = ctarg.attr('data-verb');
					ctarg.empty().append(`${verb} ${icon}`);
					contentPrev.slideDown(200);
					markdownCont.slideUp(200);
				}else{ // show markdown and load images
					markdownCont.find('img').each((i, img) => {
						const src = $(img).attr('data-src');
						if(src && src.length > 0) $(img).attr('src', src);
					});
					const icon = this.heroicon('chevron-up') || '↑';
					ctarg.empty().append(`less ${icon}`);
					contentPrev.slideUp(200);
					markdownCont.slideDown(200);
				}
				ctarg.animate({opacity:1}, 200);
			});
			content_div.append(expandLink);
		}

		return content_div;
	}

	pause() {
		this.paused = this.paused? false: true;
	}

	// Load the state from chrome.storage.local
	loadState() {
		chrome.storage.local.get(['invoices', 'current_user_url', 'settings', 'currentCaptcha', 'bookmarks'], (result) => {
			if (chrome.runtime.lastError) {
				console.error('Error loading state:', chrome.runtime.lastError);
				return;
			}
			this.state.invoices 		= result.invoices 			|| {};
			this.state.current_user_url = result.current_user_url 	|| '';
			this.state.settings 		= result.settings 			|| {};
			this.state.currentCaptcha 	= result.currentCaptcha 	|| null;
			this.state.bookmarks 		= result.bookmarks 			|| {};

			if (Object.keys(this.state.settings).length < Object.keys(this.settingsDefault).length) {
				this.state.settings = JSON.parse(JSON.stringify(this.settingsDefault));
			}

			this.currentCaptcha = this.state.currentCaptcha || null;
			if(!this.currentCaptcha) this.currentCaptcha = Object.keys(this.state.invoices)[0] || null;

			this.updateConversionRates();

			// background.js will have already sent the current user URL, so we need to update the state manually on startup.
			// Don't bother if .threads exist. We don't want to load threads twice if loadState is called for a reason other than startup.
			try{
				if($('.thread').add('.chat').add('.invoice').add('.tree_part').add('.bookmark_container').length <= 0){
					chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
						for (let i = 0; i < tabs.length; i++) {
							const tab = tabs[i];
							// If the tab is not the curren open tab in the browser, skip it.
							if(!tab.active) continue;
							this.getThreads(tabs[0].url);
						}
					});
				}
			}catch(e){
				// do nothing
			}
		});
	}

	// Save the current state to chrome.storage.local
	saveState() {

		this.state.my_invoice_ids = [];
		// Get all the invoices that have secrets and get the ID from the start of the string
		for (let name in this.state?.invoices || {}) {
			if(this.state.invoices[name].secret && typeof this.state.invoices[name].secret == 'string' && this.state.invoices[name].secret.length > 0){
				var invoice = this.state.invoices[name];
				if(!('repo' in invoice) || !invoice.repo || typeof invoice.repo != 'string' || invoice.repo.length < 3) continue
				var repo_split = invoice.repo.split(' ');
				if(repo_split.length < 1 || isNaN(repo_split[0]*1)) continue;
				this.state.my_invoice_ids.push(repo_split[0]*1);
			}
		}

		// Save currentCaptcha to state for use when the extension is re-opened.
		this.state.currentCaptcha = this.currentCaptcha + '';
		chrome.storage.local.set(this.state, () => {
			if (chrome.runtime.lastError) {
				console.error('Error saving state:', chrome.runtime.lastError);
			}
		});

		const server_url = this.getSetting('server_url');
		if(!server_url || typeof server_url != 'string' || server_url.length < 1) return;
		$('#server_link').prop('href',server_url).empty().append(server_url.replace(/https?:\/\//, ''));
	}

	cachePass(thread_id, pass) { // TODO: Create a modal with input masking
		this.passCache[`t${thread_id}`] = pass;
		return pass;
	}

	getCachedPass(thread_id = null) {
		if(isNaN(thread_id*1) || !(`t${thread_id}` in this.passCache)) return null;
		return this.passCache[`t${thread_id}`];
	}
	
	// Saves invoice to state
	addInvoice(captcha, secret, val, curr, repo){
		if(!captcha || typeof captcha != 'string' || captcha.length < 1){
			this.feed('Invalid Wallet Created.', true);
			return;
		};
		this.state.invoices = this.state.invoices || {};
		this.state.invoices[captcha] = {
			secret:			secret,
			satoshi_paid: 	0,
			btc_paid:		'0.0',
			repo:			repo,
			balance:		0, // satoshi remaining
			conv_balance:	0, // dollar value of balance
			created:		new Date().toISOString(),
			tokens:			0, // total api calls awarded
			rate_quote:		0,
			val:			val,
			curr:			curr,
			link:			null,
			server_url:		this.getSetting('server_url'),
		};
		this.saveState();
		this.buildWalletForm();
	}
	
	createWallet(val, curr, ccode = null) {

		// default ccode to BTC if not provided
		if(!ccode || typeof ccode != 'string' || ccode.length < 1 || ['xmr','btc'].indexOf(ccode.toLowerCase()) < 0) ccode = null;

		if(!ccode || ccode.length < 1){
			this.feed('Invalid currency code.', true);
			return;
		}

		const server_url = this.getSetting('server_url');
		if (!server_url || typeof server_url != 'string' || server_url.length < 1) {
			this.feed('Server URL not set.', true);
			return;
		}
		const buyEndpoint 	= `${server_url}/buy?val=${encodeURIComponent(val)}&cur=${encodeURIComponent(curr)}&ccode=${encodeURIComponent(ccode)}`;
		fetch(buyEndpoint)
			.then(response => {
				if (response.ok) {
					return response.text();
				} else {
					throw new Error('Network response was not ok');
				}
			})
			.then(json => { //  Expected: { "captcha_id": None, "secret": None, "error": None }
				const data = typeof json == 'string'? JSON.parse(json): json;
				if(!data || typeof data != 'object'){
					this.feed('Server response parse failed.', true);
					return;
				}
				const captchaId 		= data?.captcha_id 		|| null;
				const secret			= data?.secret			|| null;
				const error 			= data?.error			|| null;
				const recovery_phrase	= data?.recovery_phrase	|| null;
				if (error) {
					this.feed(error, true);
					return;
				}
				if (!captchaId) {
					this.feed('No captcha ID received.', true);
					return;
				}
				if (!secret) {
					this.feed('No secret received.', true);
					return;
				}
				this.addInvoice(captchaId, secret, val, curr, recovery_phrase);
				this.saveState();
				this.buildWalletForm();
				this.feed(`Received Captcha ID: ${captchaId}`);
				const server_url = this.getSetting('server_url');
				if (!server_url || typeof server_url != 'string' || server_url.length < 1) {
					this.feed('Server URL not set.', true);
					return;
				}
				const form 			= $(`<form method="post" class="request_invoice_form" action="${server_url}/request_invoice_creation" target="_blank"></form>`);
				const captchaInput 	= $(`<input type="hidden" name="captcha_id" value="${captchaId}">`);
				const secretInput 	= $(`<input type="hidden" name="secret" value="${secret}">`);
				form.append(captchaInput,secretInput);
				$('#container').append(form);
				form.submit();
				$('#container').find('.request_invoice_form').remove();
			})
			.catch(error => {
				this.feed('There has been a problem with your fetch operation. See console.', true);
				console.error(error);
			})
	}

	recoverInvoice(form){
		const server_url  		= this.getSetting('server_url');
		if (!server_url || typeof server_url != 'string' || server_url.length < 1) {
			this.feed('Server URL not set.', true);
			return;
		}
		const recoverEndpoint 	= `${server_url}/recover_invoice`;
		const formObj			= new FormData(form);
		fetch(recoverEndpoint, {
			method: 'POST',
			body: formObj
		})
		.then(response => {
			
			if (response.ok) {
				return response.text();
			} else {
				throw new Error('Network response was not ok');
			}
		})
		.then(json => {
			
			const data = typeof json == 'string'? JSON.parse(json): json;
			if(!data || typeof data != 'object'){
				this.feed('Server response parse failed.', true);
				return;
			}
			if (data.error) {
				this.feed(data.error, true);
			} else {
				this.feed(data.msg);
				this.addInvoice(data.captcha_id, data.secret, data.face_value, data.face_currency, $('.invoice_recovery_form').find('.mnemonic_phrase').val());
				this.saveState();
				this.redeemInvoice(data.captcha_id);
				this.feed(data.msg);
                $('.invoice_recovery_form').find('.mnemonic_phrase').val('');
			}
		})
		.catch(error => {
			this.feed('There has been a problem with your fetch operation. See console.', true);
			console.error(error);
		});
	}

	deleteNoLinkInvoices(){
		for (let name in this.state.invoices) {
			if(!this.state.invoices[name].link || this.state.invoices[name].link.length < 1){
				delete this.state.invoices[name];
			}
		}
		this.saveState();
		this.buildWalletForm();
	}

	rollupInvoices(form){
		const server_url  		= this.getSetting('server_url');
		if (!server_url || typeof server_url != 'string' || server_url.length < 1) {
			this.feed('Server URL not set.', true);
			return;
		}
		const recoverEndpoint 	= `${server_url}/recover_invoice`;
		const formObj			= new FormData(form);
		return null;
	}

	// Create a thread
	createThread(captcha_id, description, password, channel = null) {
		if(this.paused) return;
		this.sendChat(captcha_id, description, 0, 0, 0, password, channel);
	}

	// send chat or create threda (reply_to is zero)
	sendChat(captcha_id, content, reply_to = 0, thread_id = 0, spend = 0, password = null, channel = null) {
		if(this.paused) return;

		// Save these just in case the user needs to complete a captcha
		this.contentCacheFC 	= content.toString() + "";
		this.replyToCacheFC 	= reply_to*1;
		this.threadIdCacheFC 	= thread_id*1;
		this.currentCaptcha 	= captcha_id;
		this.newPassCacheFC 	= password;

		$('.superchat_input').val('');
		$('.superchat_satoshi').val(0);
		const currentURL 	= this.getCurrentURL();
		const server_url 	= this.getSetting('server_url');
		if (!server_url || typeof server_url != 'string' || server_url.length < 1) {
			this.feed('Server URL not set.', true);
			return;
		}
		const chatEndpoint 	= `${server_url}/send_chat`;
		const formData 		= new FormData();
		if(captcha_id != 'free'){ // can be null for free chat
			formData.append('captcha_id', captcha_id);
			formData.append('secret', (this.state.invoices?.[captcha_id] || {})?.secret);
			formData.append('spend', spend);
			if(spend && !isNaN(spend*1) && spend > 0) this.transactionCaptcha = captcha_id;
		}
		formData.append('content', content.toString());
		formData.append('url', currentURL);
		formData.append('reply_to', reply_to);
		formData.append('thread_id', thread_id);
		formData.append('channel', channel);
		if(!reply_to){
			for(var prop in this.state.currentMetadata){ // New thread, send URL metadata for card creation
				if(!prop || prop.length < 1) continue;
				formData.append(`metadata_${prop}`, this.state.currentMetadata[prop] || null);
			}
			if(password){ // Don't send cached password if it's a new thread
				formData.append('password', password);
			}
		}else{
			if(!password && thread_id) password = this.getCachedPass(thread_id);
			formData.append('password', password);
		}

		this.clearChatCloneContainer(true);
		fetch(chatEndpoint, {
			method: 'POST',
			body: formData
		})
		.then(response => {
			
			if (response.ok) {
				return response.text();
			} else {
				throw new Error('Network response was not ok');
			}
		})
		.then(json => {
			
			const data = typeof json == 'string'? JSON.parse(json): json;
			if(!data || typeof data != 'object'){
				this.feed('Server response parse failed.', true);
				return;
			}
			if (data.error) {
				this.feed(data.error, true);
			} else {
				const msg = data?.msg || 'Message sent.';
				this.feed(msg);
			}
			
			// If the user is sending a free chat, they must complete a captcha.
			// Free chats are sent to another endpoint that validates the captcha.
			if("image_data" in data && data.image_data){
				const tmpCaptcha 	= data?.captcha_id || null;
				const tmpMsg 		= data?.msg || 'Please complete the captcha to send your message.';
				this.feed(tmpMsg);
				// Create a form at the bottom of the home tab
				const captchaForm = $(
					`<form class="free_chat_captcha_form">
						<input type="hidden" name="captcha_id" value="${tmpCaptcha}">
						<img style="width:100%;max-width:100%;" src="${data.image_data.startsWith("data:image/png;base64,")? data.image_data: `data:image/png;base64,${data.image_data}`}">
						<br><br>
						<input type="text" name="human_guess" class="free_chat_human_guess" placeholder="Enter the captcha...">
						<input type="submit" value="Submit">
					</form>`
				);
				const cancelIcon = this.heroicon('x-mark') || '❌';
				const captchaCancel = $(`<a href="#" class="cancel_free_chat">${cancelIcon} Cancel</a>`);
				captchaCancel.on('click', (event) => {
					event.preventDefault();
					$('#captcha_form_container').remove();
				});
				captchaForm.on('submit', (event) => {
					event.preventDefault();
					const formData = new FormData(event.currentTarget);

					// Saved for captcha use
					formData.append('content', this.contentCacheFC);
					formData.append('reply_to', this.replyToCacheFC);
					formData.append('thread_id', this.threadIdCacheFC);
					formData.append('password', this.newPassCacheFC);
					
					formData.append('url', this.getCurrentURL());

					for(var prop in this.state.currentMetadata){ // New thread, send URL metadata for card creation
						if(!prop || prop.length < 1) continue;
						formData.append(`metadata_${prop}`, this.state.currentMetadata[prop] || '');
					}
					this.contentCacheFC = null;
					this.replyToCacheFC = null;
					this.threadIdCacheFC = null;
					this.newPassCacheFC = null;
					const server_url = this.getSetting('server_url');
					if (!server_url || typeof server_url != 'string' || server_url.length < 1) {
						this.feed('Server URL not set.', true);
						return;
					}
					const freeChatEndpoint = `${server_url}/send_chat_free`;
					// delete free_chat_captcha_form
					$('.free_chat_captcha_form').remove();
					fetch(freeChatEndpoint, {
						method: 'POST',
						body: formData
					})
					.then(response => {
						
						if (response.ok) {
							return response.text();
						} else {
							throw new Error('Network response was not ok');
						}
					})
					.then(json => {
						
						const data = typeof json == 'string'? JSON.parse(json): json;
						if(!data || typeof data != 'object'){
							this.feed('Server response parse failed.', true);
							return;
						}
						if (data.error) {
							this.feed(data.error, true);
						} else {
							const msg = data?.msg || 'Message sent.';
							this.feed(msg);
							if(this.currentThreadID){
								this.loadThread(this.currentThreadID);
							}else{
								this.getThreads();
							}
						}
						this.clearChatCloneContainer(true);
					})
					.catch(error => {
						this.feed('There has been a problem with your fetch operation. See console.', true);
						console.error(error);
					})
					.finally(() => {
						$('#captcha_form_container').slideUp(200, () => { $('#captcha_form_container').empty(); });
					});
				});
				$('#send_link').hide();
				$('#captcha_form_container').empty().append(captchaForm,'<br>',captchaCancel).slideDown(200,function(){
					$('.free_chat_human_guess').focus();
				});
			}

			this.skipFeed = true;
			var currentThreadId = this.getCurrentThreadID();
			if(currentThreadId){
				this.loadThread(currentThreadId,this.getCachedPass(currentThreadId));
			}else{
				this.getThreads();
			}
		})
		.catch(error => {
			this.feed('There has been a problem with your post operation. See console.', true);
			console.error(error);
		});
	}

	isFollowing(alias){
		const selectedWalletID = this.getSelectedWalletID();
		try{
			const invoice = this.state.invoices?.[selectedWalletID];
			const follows = invoice?.follows || [];
			return follows.indexOf(alias) > -1;
		}catch(e){
			console.error(e);
		}
		return false;
	}
	
	updateFollowList(captchaId = null, build_follow_list = false){
		if(this.paused) return;
		if(captchaId.toLowerCase() == 'free'){
			// refresh the page
			if(this.currentThreadID){
				this.loadThread(this.currentThreadID,null,true);
			}else{
				this.getThreads();
			}
			return;
		}
		this.followSearch = captchaId + '';
		const formData = new FormData();
		formData.append('captcha_id', captchaId);
		formData.append('secret', this.getInvoiceSecret(captchaId));
		const server_url = this.getSetting('server_url');
		if (!server_url || typeof server_url != 'string' || server_url.length < 1) {
			this.feed('Error: Server URL not set.', true);
			return;
		}
		const getFollowsEndpoint = `${server_url}/get_my_follows`;
		fetch(getFollowsEndpoint, {
			method: 'POST',
			body: formData
		})
		.then(response => {
			if (response.ok) {
				return response.text();
			} else {
				throw new Error('Network response was not ok');
			}
		})
		.then(json => {
			const data = typeof json == 'string'? JSON.parse(json): json;
			this.followSearch = this.followSearch || this.currentCaptcha;
			const invoice = this.followSearch in this.state.invoices? this.state.invoices[this.followSearch]: null;
			if(invoice) invoice.follows = data?.follows || [];
			this.saveState();
			if(this.currentThreadID){
				this.loadThread(this.currentThreadID,null,true);
			}else{
				this.getThreads();
			}
			if(build_follow_list) this.buildFollowList();
		})
		.catch(error => {
			this.feed('Failed to fetch follows.', true);
			console.error(error);
		});
	}

	buildFollowList(){
        $('#nav-close').show(300);
		$('#form_container').empty().css({display:'block'}).addClass('follow_list').append('<h2>My Follows</h2>');
		const serverURL = this.getSetting('server_url');
		if(!serverURL){
			$('#form_container').append('<p><strong>ERROR:</strong> Server URL not set.</p>');
			return;
		}
		$('#form_container').append(serverURL);
		var followCount = 0;
		for(let captchaId in this.state.invoices){
			const invoice = this.state.invoices[captchaId];

			// Skip invoices that don't have follows
			if(!('follows' in invoice) || !invoice.follows || !Array.isArray(invoice.follows) || invoice.follows.length < 1) continue;

			// skip invoices that are not on this server
			if(invoice.server_url != serverURL) continue;

			var captchaName = captchaId.substring(0, 8) + '...';
			if('alias' in invoice && invoice.alias && typeof invoice.alias == 'string' && invoice.alias.length > 0) captchaName = invoice.alias;
			const userFollows = invoice?.follows || [];
			const followCount = userFollows.length;
			$('#form_container').append(`<h4>${captchaName} follows ${followCount} user${( followCount == 1? '': 's' )}</h4>`);
			if(followCount < 1) continue
			const followList = $('<ul class="follow_ul"></ul>');
			for(var i=0; i<followCount; i++){
				const u = userFollows[i];
				const unfollow_link = $(`<a href="#" class="unfollow_link error" data-alt-captcha="${captchaId}" data-alias="${u}" title="Unfollow this user">${this.heroicon('user-minus')} Unfollow</a>`);
				unfollow_link.on('click', (event) => {
					const targ = $(event.currentTarget);
					targ.animate({opacity: 0}, 200).animate({opacity: 1}, 200);
					this.followUser(targ.data('alias'), 'yes', true, targ.attr('data-alt-captcha'));
				});
				const user_page_link = $(`<a class="follow_item" href="${serverURL}/u/${u}" title="Visit this user's page." target="_blank">${u}&nbsp;&nbsp;</a>`);
				const li = $('<li></li>');
				li.append(user_page_link).append(unfollow_link);
				followList.append(li);
			}
			$('#form_container').append(followList);
		}
		if(followCount < 1){
			$('#form_container').append('<p>No follows found.</p>');
		}
	}

	followUser(alias, unfollow_str = 'no', build_follow_list = false, altCaptcha = null){
		const formData 		= new FormData();
		const captchaId 	= altCaptcha || this.getSelectedWalletID();
		const secret 		= this.getInvoiceSecret(captchaId);
		const server_url 	= this.getSetting('server_url');
		this.followSearch 	= captchaId + '';
		this.followAlias 	= alias + '';
		this.unfollowStr 	= unfollow_str + '';
		formData.append('verified_username_follow',	alias);
		formData.append('unfollow', unfollow_str);
		formData.append('captcha_id',captchaId);
		formData.append('secret', secret);
		if (!server_url || typeof server_url != 'string' || server_url.length < 1) {
			this.feed('Server URL not set.', true);
			return;
		}
		const followEndpoint = `${server_url}/follow`;
		fetch(followEndpoint, {
			method: 'POST',
			body: formData
		})
		.then(response => {
			if (response.ok) {
				return response.text();
			} else {
				throw new Error('Network response was not ok');
			}
		})
		.then(json => {
			const data = typeof json == 'string'? JSON.parse(json): json;
			if(!data || typeof data != 'object'){
				this.feed('Follow operation failed.', true);
				return;
			}
			if (data.error) {
				this.feed(data.error, true);
			} else {
				this.feed(data.msg);
			}
			const invoice = this.state.invoices?.[this.followSearch];
			if(invoice && this.followAlias && typeof this.followAlias == 'string' && this.followAlias.length > 0){
				const follow_links = $(`.follow_link[data-alias="${this.followAlias}"]`);
				follow_links.find('svg').remove();
				if(this.unfollowStr == 'yes'){
					while(invoice.follows.indexOf(this.followAlias) > -1){
						invoice.follows.splice(invoice.follows.indexOf(this.followAlias),1);
					}
					follow_links.attr('title','Follow this user').attr('data-unfollow','no').prepend(this.heroicon('plus'));
				}else{
					if(invoice.follows.indexOf(this.followAlias) < 0) invoice.follows.push(this.followAlias);
					follow_links.attr('title','Unfollow this user').attr('data-unfollow','yes').prepend(this.heroicon('minus'));
				}
				this.saveState();
			}
			if(build_follow_list){
				this.updateFollowList(this.followSearch, build_follow_list); // Fetches my follows from the server and saves state.
			}
			this.followSearch 	= null;
			this.followAlias 	= null;
			this.unfollowStr 	= null;
		})
		.catch(error => {
			this.feed('Follow operation failed on server end.', true);
			console.error(error);
		});
	}
	
	reactDiv(chat_id, timestamp = null, sender_crypto_wallets = null, is_thread = false){ // reply_count is only used by threads.
		const container = $('<div class="reaction_container"></div>');
		var date_str = '';
		if(timestamp && typeof timestamp == 'string' && timestamp.length > 0){
			// Attempt to parse the timestamp and reformat as date + timezone
			try{
				const dateObj = new Date(timestamp);
				// Get the number of minutes passed since the message was sent
				const minutesPassed = Math.floor((new Date() - dateObj) / 60000);
				const hoursPassed	= Math.floor(minutesPassed / 60);
				const daysPassed	= Math.floor(hoursPassed / 24);
				const weeksPassed	= Math.floor(daysPassed / 30);
				const monthsPassed	= Math.floor(weeksPassed / 4);
				const yearsPassed	= Math.floor(monthsPassed / 12);
				if(yearsPassed > 0){
					date_str = `${yearsPassed} year${yearsPassed > 1? 's': ''} ago`;
				}else if(monthsPassed > 0){
					date_str = `${monthsPassed} month${monthsPassed > 1? 's': ''} ago`;
				}else if(weeksPassed > 0){
					date_str = `${weeksPassed} week${weeksPassed > 1? 's': ''} ago`;
				}else if(daysPassed > 0){
					date_str = `${daysPassed} day${daysPassed > 1? 's': ''} ago`;
				}else if(hoursPassed > 0){
					date_str = `${hoursPassed} hour${hoursPassed > 1? 's': ''} ago`;
				}else if (minutesPassed > 0){
					date_str = `${minutesPassed} minute${minutesPassed > 1? 's': ''} ago`;
				}else{
					date_str = 'Just now';
				}	
			}catch(e){
				date_str = timestamp.split(" ");
				date_str = date_str.length > 5? date_str[0] + ' ' + date_str[1] + ' ' + date_str[2] + ' ' + date_str[3] + ' ' + date_str[5]: date_str.join(" ");
			}
		}
		if(sender_crypto_wallets && typeof sender_crypto_wallets == 'string' && sender_crypto_wallets.length > 0){
			container.append(`&nbsp;<div style="display:inline-block;opacity:0.4;font-weight:600;font-size:0.7em;padding-top:8px;">${sender_crypto_wallets}</div>`);
		}
		container.append(`<span class="time_info">&nbsp;${date_str}</span>&nbsp;`);
		container.append(
			`<span class="reaction_link_span pull-right">
				<a href="#" class="reaction_button like_button" data-chat-id="${chat_id}" style="padding-right:3px;padding-left:3px;">
					${this.heroicon('chevron-up')}
					<span class="reaction_count like_count" data-chat-id="${chat_id}">0</span>
				</a>
				<a href="#" class="reaction_button dislike_button" data-chat-id="${chat_id}" style="padding-left:3px;padding-right:3px;">
					${this.heroicon('chevron-down')}
					<span class="reaction_count dislike_count" data-chat-id="${chat_id}">0</span>
				</a>
				<a href="#" class="chat_opts_opener" data-chat-id="${chat_id}" style="padding-left:3px;padding-right:3px;">
					${this.heroicon('ellipsis-vertical')}
				</a>
			</span>`,
			`<div class="chat_opts_container" data-chat-id="${chat_id}" style="display:none;padding:6px;line-height:1.2em;text-align:right;width:100%;"></div>`
		);
		if(is_thread) container.prepend('<br>');

		// Cross-posting and replies
		var crossPostLink = $(`<a href="#" class="cross_post_link" data-chat-id="${chat_id}" title="Cross-Post chat to another thread." style="padding-left:15px;"></a>`);
		crossPostLink.append(this.heroicon('arrows-right-left') || '⇄', '&nbsp;Cross-Post');
		crossPostLink.off('click').on('click', (event) => {
			event.preventDefault();
			$('.reply_link').add('.cross_post_link').removeClass('active');
			$(event.currentTarget).addClass('active');
			const chat_id 	= $(event.currentTarget).attr('data-chat-id');
			const title 	= $(event.currentTarget).attr('title');
			var targetChatDiv = $(`.chat[data-id="${chat_id}"]`);
			if(targetChatDiv.length < 1) targetChatDiv = $(`.original_chat[data-id="${chat_id}"]`); // user could be trying to cross post the top chat
			if(targetChatDiv.length < 1) return; // chat not found
			const crossPostClone = targetChatDiv.first().clone();
			crossPostClone.addClass('cross_post_clone').removeClass('chat').removeClass('my_chat').removeClass('original_chat'); // .cross_post_clone is ephemeral, not the same as .cross_post
			crossPostClone.find('.reaction_link_span').remove();
			crossPostClone.find('.cross_post_link').remove();
			crossPostClone.find('.reply_link').remove();
			crossPostClone.find('.reply_container').remove();
			crossPostClone.find('.blur_link').remove();
			crossPostClone.find('.chat_opts_container').remove();
			const cancelIcon = this.heroicon('x-mark') || '❌';
			const cancelLink = $(`<a href="#" class="cancel_cross_post pull-right faded" title="Cancel Cross-Post">${cancelIcon}&nbsp;Cancel Cross-Post</a>`);
			cancelLink.on('click', (event) => {
				event.preventDefault();
				this.clearChatCloneContainer(true);
			});
			$('#reply_clone_container').css({display:'none'}).empty().append(`<hr><span class="xpost_info">${title}`,crossPostClone,'</span><br>&nbsp;',cancelLink).slideDown(300);
		});
		var replyLink = $(`<a href="#" class="reply_link chat_reply_link" data-chat-id="${chat_id}" title="Reply to chat." style="padding-left:15px;"></a>`);
		replyLink.append(
			(this.heroicon('chat-bubble-bottom-center') || '💬'),
			(is_thread? `<span class="chat_reply_count" data-chat-id="${chat_id}" style="padding-left:4px;"></span>`: '&nbsp;Reply')
		);
		replyLink.off('click').on('click', (event) => {
			event.preventDefault();
			$('.reply_link').add('.cross_post_link').removeClass('active');
			$(event.currentTarget).addClass('active');
			const replying_to_id 	= $(event.currentTarget).attr('data-chat-id');
			if($(`.thread_opener[data-chat-id="${replying_to_id}"]`).length > 0){
				$(`.thread_opener[data-chat-id="${replying_to_id}"]`).trigger('click');
				return; // user intends to open the thread, not reply to the thread opener
			}
			const title			 	= $(event.currentTarget).attr('title');	
			const targetChatDiv 	= $(`.chat[data-id="${replying_to_id}"]`);
			if(targetChatDiv.length < 1) return;
			const replyToClone = targetChatDiv.clone();
			replyToClone.removeClass('chat');
			replyToClone.addClass('reply_to_clone'); // Add to chat context
			replyToClone.find('.cross_post_link').remove();
			replyToClone.find('.reply_link').remove();
			replyToClone.find('.reaction_link_span').remove();
			replyToClone.find('.reply_container').remove();
			replyToClone.find('.blur_link').remove();
			replyToClone.find('.chat_opts_container').remove();
			const cancelIcon = this.heroicon('x-mark') || '❌';
			const cancelLink = $(`<a href="#" class="cancel_reply_to pull-right faded" title="Cancel Reply">${cancelIcon}&nbsp;Cancel Reply</a>`);
			cancelLink.on('click', (event) => {
				event.preventDefault();
				this.clearChatCloneContainer();
			});
			$('#reply_clone_container').css({display:'none'}).empty().append(`<hr><span class="chat_info">${title}</span>`,replyToClone,'<br>&nbsp;',cancelLink).slideDown(300,function(){
				$('#chat_input').focus();
			});
		});
		container.find('.chat_opts_opener').off().on('click', (event) => {
			const chat_id = $(event.currentTarget).attr('data-chat-id') || null;
			if(!chat_id) return;
			const chat_opts = $(`.chat_opts_container[data-chat-id="${chat_id}"]`).first(); // children can contain multiple chat_opts_container
			if(chat_opts.length < 1) return;
			$('.chat_opts_container').not(chat_opts).slideUp(200);
			chat_opts.slideToggle(200);
		});
		if(is_thread){ // threads don't use .chat_opts_container
			container.find('.reaction_link_span').prepend(replyLink);
			const embedIcon = '&lt;/&gt;';
			const embedLink = $(`<a href="#" class="embed_link" data-chat-id="${chat_id}" title="Embed this chat." style="padding-left:15px;">${embedIcon} Embed</a>`);
			embedLink.on('click', (event) => {
				const parentThreadDiv = $(event.currentTarget).closest('.thread').first();
				const threadId = parentThreadDiv.attr('data-thread-id') || null;
				if(!threadId){
					this.feed('Thread ID not found.', true);
					return;
				}
				const serverURL = this.getSetting('server_url');
				if(!serverURL){
					this.feed('Server URL not set.', true);
					return;
				}
				const threadLink 	= `${serverURL}/thread/${threadId}`;
				const darkLink		= threadLink + '?dark';
				const urlLightLink	= $(`<a class="tmp_embed_link" data-copy="${threadLink}">URL (light mode)</a>`);
				const urlDarkLink	= $(`<a class="tmp_embed_link" data-copy="${darkLink}">URL (dark mode)</a>`);
				const iframeLink	= $(`<a class="tmp_embed_link" data-copy="<iframe src='${threadLink}' style='width:100%;height:100%;border:none;'></iframe>">Embed (light mode)</a>`);
				const iframeDarkLink= $(`<a class="tmp_embed_link" data-copy="<iframe src='${darkLink}' style='width:100%;height:100%;border:none;'></iframe>">Embed (dark mode)</a>`);
				$(event.currentTarget).parent().append(
					'<br class="tmp_br">',
					urlLightLink,
					'<br class="tmp_br">',
					iframeLink,
					'<br class="tmp_br">',
					urlDarkLink,
					'<br class="tmp_br">',
					iframeDarkLink,
				);
				$(event.currentTarget).css({display:'none'});
				urlLightLink.on('click', (event) => {
					event.preventDefault();
					const copyText = $(event.currentTarget).attr('data-copy') || null;
					if(!copyText){
						this.feed('Copy failed.', true);
						return;
					}
					navigator.clipboard.writeText(copyText);
					this.feed('Thread link copied to clipboard.');
					$(`.tmp_embed_link`).add(`.tmp_br`).remove(); // remove all tmp_embed_links
					$('.embed_link').css({display:'block'}); // show the embed link again
				});
				urlDarkLink.on('click', (event) => {
					event.preventDefault();
					const copyText = $(event.currentTarget).attr('data-copy') || null;
					if(!copyText){
						this.feed('Copy failed.', true);
						return;
					}
					navigator.clipboard.writeText(copyText);
					this.feed('Thread link copied to clipboard.');
					$(`.tmp_embed_link`).add(`.tmp_br`).remove(); // remove all tmp_embed_links
					$('.embed_link').css({display:'block'}); // show the embed link again
				});
				iframeLink.on('click', (event) => {
					event.preventDefault();
					const copyText = $(event.currentTarget).attr('data-copy') || null;
					if(!copyText){
						this.feed('Copy failed.', true);
						return;
					}
					navigator.clipboard.writeText(copyText);
					this.feed('Thread iframe copied to clipboard.');
					$(`.tmp_embed_link`).add(`.tmp_br`).remove(); // remove all tmp_embed_links
					$('.embed_link').css({display:'block'}); // show the embed link again
				});
				iframeDarkLink.on('click', (event) => {
					event.preventDefault();
					const copyText = $(event.currentTarget).attr('data-copy') || null;
					if(!copyText){
						this.feed('Copy failed.', true);
						return;
					}
					navigator.clipboard.writeText(copyText);
					this.feed('Thread iframe copied to clipboard.');
					$(`.tmp_embed_link`).add(`.tmp_br`).remove(); // remove all tmp_embed_links
					$('.embed_link').css({display:'block'}); // show the embed link again
				});
			});
			container.find('.chat_opts_container').append(
				embedLink
			);
		}else{
			container.find('.chat_opts_container').append(
				crossPostLink,
				replyLink,
			);
		}
		return container;
	}

	createFollowLink(alias, is_me = false, is_free = false){
		var link, alias_str = (alias && typeof alias == 'string')? alias: '';
		if(is_me){
			link = $('<span class="chat_info">Me</span>');
		}else if(is_free){
			link = $('<span class="chat_info faded" style="font-style:italic;">free user</span>');
		}else if(alias_str.startsWith('$')){
			const iFollow		= this.isFollowing(alias_str);
			const followIcon	= iFollow? this.heroicon('minus'): this.heroicon('plus');
			const unfollowStr	= iFollow? 'yes': 'no';
			const verb			= iFollow? 'Unfollow': 'Follow';
			link				= $(`<a href="#" title="${verb}" class="follow_link" data-alias="${alias_str}" data-unfollow="${unfollowStr}">${followIcon}&nbsp;${alias_str}</a>`);
			link.click((event) => {
				event.preventDefault();
				if(this.paused) return;
				const targ = $(event.currentTarget);
				const alias_str = targ.attr('data-alias');
				const unfollow = targ.attr('data-unfollow');
				this.followUser(alias_str, unfollow);
				targ.animate({opacity: 0}, 50).animate({opacity: 0.7}, 300);
			});
		}else{
			link = $(`<span class="chat_info">${alias_str}</span>`);
		}
		return link;
	}

	createUserPageLink(alias){
		var link = '';
		if(alias && typeof alias == 'string' && alias.startsWith('$')){
			const server_url 	= this.getSetting('server_url');
			const icon			= this.heroicon('arrow-top-right-on-square') || '⎘';
			if(server_url) link = `<a href="${server_url}/u/${alias}" target="_blank" class="chat_info" title="Go to this user's page.">${icon}</a>`;
		}
		return link;
	}

	cleanUpTimeInfo(){ // remove redundant time elapsed descriptions.
		// loop throught .time_info in reverse
		var ticker 			= 0;
		var last_time_str 	= '';
		$('.time_info').each(function(){
			const time_str = $(this).text();
			if(time_str == last_time_str && ticker % 10) $(this).css({display: 'none'});
			last_time_str = time_str;
			ticker++; // used to skip every 10th element
		});
	}

	getInvoiceSecret(captcha_id){
		return (this.state.invoices?.[captcha_id] || {})?.secret || null;
	}

	getCurrentWalletId(){ // Numeric ID, not captcha id
		const current_wallet = this.state.invoices?.[this.getSelectedWalletID()];
		if(!current_wallet || typeof current_wallet != 'object' || !('repo' in current_wallet) || typeof current_wallet.repo != 'string') return 0;
		const repo_split = current_wallet.repo.split(' ');
		if(repo_split.length < 1 || isNaN(repo_split[0]*1)) return 0;
		return repo_split[0]*1;
	}

	updateReactions(reactions){ // Array required
		this.addBlurFunctionality();
		reactions = Array.isArray(reactions)? reactions: [];
		const walletId = this.getCurrentWalletId();
		var like_counts = {};
		for (var i=0; i<reactions.length; i++){ // label my reactions
			const reaction = reactions[i];
			if(!reaction || typeof reaction != 'object' || !('chat_ref_id' in reaction) || !('vote' in reaction) || !('invoice_ref_id' in reaction)) continue;
			try{
				const chatId = reaction.chat_ref_id;
				if(!(`chat_${chatId}` in like_counts)) like_counts[`chat_${chatId}`] = {id: chatId, up: 0, down: 0, my_vote: null};
				const vote 	= reaction.vote;
				var inv 	= reaction?.invoice_ref_id || null;
					inv 	= (inv && !isNaN(inv*1))? inv*1: null;
				switch(vote.toString().toLowerCase()){
					case 'up':
						like_counts[`chat_${chatId}`].up++;
						if(walletId == inv) like_counts[`chat_${chatId}`].my_vote = 'up';
						break;
					case 'down':
						like_counts[`chat_${chatId}`].down++;
						if(walletId == inv) like_counts[`chat_${chatId}`].my_vote = 'down';
						break;
					default:;
				}
			}catch(e){
				console.error(e);
				continue;
			}
		}

		// Update the like counts and my_reaction classes
		for(var key in like_counts){
			const o 			= like_counts[key];
			const like_btn 		= $(`.like_button[data-chat-id="${o.id}"]`);
			const dislike_btn 	= $(`.dislike_button[data-chat-id="${o.id}"]`);
			const like_count 	= $(`.like_count[data-chat-id="${o.id}"]`);
			const dislike_count = $(`.dislike_count[data-chat-id="${o.id}"]`);
			if(like_count && like_count.length) 		like_count.text(o.up);
			if(dislike_count && dislike_count.length) 	dislike_count.text(o.down);
			if(like_btn && like_btn.length > 0 && dislike_btn && dislike_btn.length > 0){
				like_btn.removeClass('my_reaction');
				dislike_btn.removeClass('my_reaction');
				if(o.my_vote == 'up') 	like_btn.addClass('my_reaction');
				if(o.my_vote == 'down') dislike_btn.addClass('my_reaction');
			}
		}

		// Get invoice_ids for invoices that have secrets
		if(Object.keys(this.state.invoices).length < 1){ // User cannot react without a secret
			$('.reaction_button').off().on('click', (event) => {
				event.preventDefault();
				this.feed('You must have an wallet secret to react to threads and chats.', true);
			});
		}else{
			$('.reaction_button').off().on('click', (event) => {
				event.preventDefault();
				const targ		= $(event.currentTarget);
				const vote		= targ.hasClass('like_button')? 'up': 'down';
				if(targ.hasClass('my_reaction')) return; // user already reacted
				targ.addClass('my_reaction');
				const counter = targ.find('.reaction_count');
				if(!isNaN(counter.text()*1)) counter.text(counter.text()*1 + 1); // preemtively increment the counter
				// If the user liked and had already disliked, remove the dislike
				const sibling = targ.parent().find(`.reaction_button.my_reaction.${(vote == 'up'? 'dislike_button': 'like_button')}`);
				if(sibling.length > 0){
					sibling.removeClass('my_reaction');
					const siblingCounter 	= sibling.find('.reaction_count');
					const siblingCount 		= siblingCounter.text().trim()*1;
					if(!isNaN(siblingCount) && siblingCount > 0) siblingCounter.text(siblingCount - 1);
				}
				const server_url = this.getSetting('server_url');
				if (!server_url) {
					this.feed('Server URL not set.', true);
					return;
				}
				const reactEndpoint = `${server_url}/chat_react`;
				const formData 		= new FormData();
				const useCaptcha	= this.getSelectedWalletID();
				if(!useCaptcha || !(useCaptcha in this.state.invoices)){
					this.feed('Invalid wallet selected.', true);
					return;
				}
				formData.append('chat_id', 		targ.attr('data-chat-id'));
				formData.append('vote', 		vote);
				formData.append('captcha_id', 	useCaptcha);
				formData.append('secret', 		this.getInvoiceSecret(useCaptcha));
				fetch(reactEndpoint, {
					method: 'POST',
					body: formData
				})
				.then(response => {
					if (response.ok) {
						return response.text();
					} else {
						throw new Error('Network response was not ok');
					}
				})
				.then(json => {
					const data = typeof json == 'string'? JSON.parse(json): json;
					if(!data || typeof data != 'object'){
						this.feed('Server response parse failed.', true);
						return;
					}
					if (data.error) {
						this.feed(data.error, true);
					} else {
						this.feed(data.msg);
						this.rollupReactions();
					}
				})
				.catch(error => {
					this.feed('There has been a problem with your fetch operation. See console.', true);
					console.error(error);
				});
			});
		}

		// need to update data-chat-count, data-like-count, and data-dislike-count for thread sorting.
		this.rollupReactions();
	}

	rollupReactions(){ // rollup reactions to the thread container
		if($('.thread').length > 0){
			$('.thread').each((index) => {
				try{
					const element		= $('.thread').eq(index);
					var chat_count 		= element.find('.chat_reply_count').first().text() || 0;
						chat_count		= (chat_count && !isNaN(chat_count*1))? chat_count*1: 0;
					var likes_count		= element.find('.like_count').first().text() || 0;
						likes_count		= (likes_count && !isNaN(likes_count*1))? likes_count*1: 0;
					var dislikes_count	= element.find('.dislike_count').first().text() || 0;
						dislikes_count	= (dislikes_count && !isNaN(dislikes_count*1))? dislikes_count*1: 0;
					element.attr('data-chat-count', chat_count);
					element.attr('data-like-count', likes_count);
					element.attr('data-dislike-count', dislikes_count);
				}catch(e){
					console.error(e);
				}
			});
		}
	}
	
	clearSearch(){
		$('#ext_search').val('').trigger('keyup');
	}

    setCurrentThreadID(threadId = null){
		// this.clearSearch();
        this.currentThreadID = (threadId && !isNaN(threadId*1))? threadId*1: null;
    }

	getCurrentThreadID(){
		return this?.currentThreadID || null;
	}

	getReplyToID(){
		try{
			const replyToID = $('#reply_clone_container').find('.reply_to_clone').attr('data-id');
			return replyToID;
		}catch(e){
			return null;
		}
	}

	getReplyToIDAndClear(){
		const replyToID = this.getReplyToID();
		this.clearChatCloneContainer();
		return replyToID;
	}

	getCrossPostID(){
		try{
			const crossPostID = $('#reply_clone_container').find('.cross_post_clone').attr('data-id');
			return crossPostID;
		}catch(e){
			return null;
		}
	}

	getCrossPostIDAndClear(){
		const crossPostID = this.getCrossPostID();
		this.clearChatCloneContainer(true);
		return crossPostID;
	}

	getTopChatID(){
		try{
			const topChatID = $('.original_chat').attr('data-id');
			return topChatID;
		}catch(e){
			return null;
		}
	}

	readAndClearChatInput(){
		const content = $('#chat_input').val();
		$('#chat_input').val('');
		return content;
	}

	clearChatCloneContainer(clear_xpost = false){
		const xpost_id = this.getCrossPostID();
		if(!xpost_id || clear_xpost){
			$('#reply_clone_container').slideUp(200,function(){
				$('#reply_clone_container').empty();
				$('.reply_link').add('.cross_post_link').removeClass('active');
			});
		}
	}

	loadingMsg(msg = null){
		msg = msg || 'Loading';
		$('#gui').empty().append(`<div class="loading_message">${msg}<span class="loading_dots">.</span></div>`);
	}

	addThreadChatIds(chat_objects){
		if(!chat_objects || !Array.isArray(chat_objects)) return;
		chat_objects.forEach( chat => {
			if(!chat || typeof chat != 'object' || !('chat_id' in chat)) return;
			if(this.allThreadChatIds.indexOf(chat.chat_id) < 0) this.allThreadChatIds.push(chat.chat_id);
		});
	}

	applyFontSizeSetting(){
		const font_size = this.getSetting('font_size');
		if(!font_size || typeof font_size != 'string' || font_size.length < 1) return;
		// validate that the font size ends with em and is a number from 0.5 to 1.5
		const font_size_num = parseFloat(font_size.replace('em',''));
		if(isNaN(font_size_num) || font_size_num < 0.5 || font_size_num > 1.5 || !font_size.endsWith('em')) return;
		$('body').css({fontSize: font_size});
	}

	addBlurLink(container){
		const chat_id 	= $(container).attr('data-id');
		if(!chat_id || isNaN(chat_id*1)) return;
		$(container).find('.blur_link').remove();
		const blur_link = $(`<a href="#" class="blur_link" data-chat-id="${chat_id}" title="Blur this item." style="padding-left:15px;"></a>`);
		blur_link.append(this.heroicon('eye-slash') || 'X', 'Blur');
		blur_link.on('click', (event) => {
			event.preventDefault();
			const chat_id = $(event.currentTarget).attr('data-chat-id');
			if(isNaN(chat_id*1)) return;
			const chat_div = $(`.chat[data-id="${chat_id}"]`);
			if(chat_div.length < 1) return;
			chat_div.addClass('blurred');
			const server_url = this.getSetting('server_url');
			if(!server_url){
				this.feed("No server URL set.", true);
				return;
			}
			const blurEndpoint = `${server_url}/blur_chat`;
			const formData = new FormData();
			formData.append('chat_id', chat_id*1);
			formData.append('captcha_id', this.getSelectedWalletID());
			formData.append('secret', this.getInvoiceSecret(this.getSelectedWalletID()));
			fetch(blurEndpoint, {
				method: 'POST',
				body: formData
			})
			.then(response => {
				if (response.ok) {
					return response.text();
				} else {
					throw new Error('Network response was not ok');
				}
			})
			.then(json => {
				const data = typeof json == 'string'? JSON.parse(json): json;
				if(!data || typeof data != 'object'){
					this.feed('Server response parse failed.', true);
					return;
				}
				if(data.error){
					this.feed(data.error, true);
				}else{
					this.feed(data.msg);
				}
			})
			.catch(error => {
				this.feed('Failed to blur chat.', true);
				console.error(error);
			});
		});
		$(container).find('.chat_opts_container').prepend(blur_link);
	}

	applyBlurSetting(){
		const blur_setting 	= this.getSetting('blur_setting');
		const blurred_els	= $('.blurred');
		switch(blur_setting){ // show, blur, or hide
			case 'show':
				blurred_els.removeClass('blur_hide').removeClass('blur_blur').addClass('blur_show');
				break;
			case 'hide':
				blurred_els.removeClass('blur_show').removeClass('blur_blur').addClass('blur_hide');
				break;
			case 'blur':
				blurred_els.removeClass('blur_show').removeClass('blur_hide').addClass('blur_blur');
				break;
			default: 
				this.feed(`Blur setting "${blur_setting}" is not valid.`,true);
		}
	}

	addBlurFunctionality(){
		const threads 	= this.modMode? $('.thread'): null;
		const chats 	= this.modMode? $('.chat').add('.original_chat'): $('.is_reply_to_me');
		if(threads && threads.length > 0){
			threads.each((index, thread) => { this.addBlurLink(thread); });
		}
		if(chats && chats.length > 0){
			chats.each((index, chat) => { this.addBlurLink(chat); });
		}
	}

	loadThread(threadId = null, password = null, force_restart = false) {
		$('#tree_count_container').css({ display: 'none' });
		if (!threadId || isNaN(threadId * 1)) threadId = this.getCurrentThreadID();
		if (this.paused || !threadId) return;
		this.midRequest = true;

		const bookmarks = this.state?.bookmarks || {};
		if (bookmarks && threadId in bookmarks) {
			$('#thread_bookmarker').removeClass('faded');
		}else{
			$('#thread_bookmarker').addClass('faded');
		}
	
		// Check if the conversion rates are current within the last minute (also fetches notifications)
		const secondsSinceEpoch = Math.round(new Date().getTime() / 1000);
		const timeSinceConvUpdate = secondsSinceEpoch - this.convUpdatedAt;
		if (timeSinceConvUpdate > 60) this.updateConversionRates();
	
		this.setCurrentThreadID(threadId);
		this.setCurrentCaptchaFromSelector();
		$('.thread').remove(); // hide all threads
		$('#chat_input').attr('placeholder', 'Chat in this thread...');
		$('#create_thread_options').css({ display: 'none' });
		if (force_restart) $('.chat').remove(); // clear all chats
		const lastChat = $('.chat').add('.original_chat').not('.cross_post').last();
		const startMode = lastChat.length > 0 ? false : true;
		if (startMode && threadId != this.lastThreadLoaded) {
			$('#chat_input').focus();
			this.loadingMsg(`Loading Thread ${threadId}`);
			this.allThreadChatIds = [];
		}
		this.lastThreadLoaded = threadId;
		const formData = new FormData();
		formData.append('thread_id', threadId);
		if (!password) password = this.getCachedPass(threadId);
		if (password) formData.append('password', password);
		const server_url = this.getSetting('server_url');
		if (!server_url) {
			this.feed('Server URL not set.', true);
			return;
		}
		const threadEndpoint = `${server_url}/get_thread_chats`;
		if (startMode) {
			$('#main_thread_chat').empty(); // Clear the main thread chat container
		}
		if (!startMode && lastChat && lastChat.length > 0) {
			formData.append('date_submitted_after', lastChat.attr('data-date-submitted'));
		}
		if (this.currentCaptcha) {
			formData.append('captcha_id', this.currentCaptcha);
			formData.append('secret', this.getInvoiceSecret(this.currentCaptcha));
		}
		fetch(threadEndpoint, {
			method: 'POST',
			body: formData
		})
			.then(response => {
				if (response.ok) {
					return response.text();
				} else {
					throw new Error('Network response was not ok');
				}
			})
			.then(json => {
				if (startMode) {
					$('#main_thread_chat').empty();
					$('#gui').empty();
					this.loadWalletSelector();
				}
				const data = typeof json == 'string' ? JSON.parse(json) : json;
				if (!data || typeof data != 'object' || !('chats' in data)) {
					this.feed('Server response parse failed.', true);
					return;
				}
				if (data.error) {
					this.feed(data.error, true);
					this.skipFeed = true;
					this.getThreads();
					return;
				}
				if (startMode) {
					this.feed(data?.msg || 'Thread loaded.');
				}
				const threadChats = data.chats;
	
				this.addThreadChatIds(threadChats); // Needed to see if X-Posts should be added directly to the thread.
	
				// Sort the chats by date_submitted
				threadChats.sort((a, b) => {
					if (a.date_submitted < b.date_submitted) return -1;
					if (a.date_submitted > b.date_submitted) return 1;
					return 0;
				});
	
				const hide_free_chats = this.getSetting('hide_free_chats');
	
				threadChats.forEach(chat => {
					const isMe = chat?.is_me || false;
					const isFree = chat?.is_free || false;
					const isTop = (!chat.reply_to_id && chat.thread_id == threadId) ? true : false;
					const isSuper = (chat.superchat && !isNaN(chat.superchat * 1) && chat.superchat > 0) ? true : false;
					const isBlurred = (chat.blurred && chat.blurred == 1) ? true : false;
	
					if (hide_free_chats && isFree) return; // Do not add free chats if setting is enabled
	
					// Do not add chats that are already in the thread
					if ($(`.chat[data-id="${chat.chat_id}"]`).length > 0) return; // chat already rendered, skip
	
					// Do not re-render top chat ever (it should always load once and never again)
					if (isTop && !startMode) return;
	
					if (!startMode && this.skipAutoScroll && !isTop) this.newMessages++;
	
					var chatDivClasses = [],
						superChatStr = '';
					if (isFree) chatDivClasses.push('free_chat');
					if (isMe) chatDivClasses.push('my_chat');
					if (isTop) {
						chatDivClasses.push('original_chat');
					} else {
						chatDivClasses.push('chat');
						chatDivClasses.push('hidden_chat');
					}
					if (isBlurred) {
						chatDivClasses.push('blurred');
					}
					if (isSuper) {
						chatDivClasses.push('superchat');
						const amount = chat.superchat * 1;
						const fiatStr = this.satoshiToFiatStr(amount, chat?.sender_crypto_type);
						const cryptoStr = this.satoshiToCryptoStr(amount, chat?.sender_crypto_type);
						const star = this.heroicon('star-solid') || '⭐';
						superChatStr = `<div class="superchat_amount">${star}&nbsp;${star}&nbsp;${star}&nbsp;&nbsp;${cryptoStr}&nbsp;&nbsp;${fiatStr}&nbsp;&nbsp;${star}&nbsp;${star}&nbsp;${star}</div>`;
					}
					chatDivClasses = chatDivClasses.join(' ');
					const chatDiv = $(
						`<div class="${chatDivClasses}" data-id="${chat.chat_id}" data-reply-to-id="${chat.reply_to_id}" data-date-submitted="${chat.date_submitted}" data-alias="${(chat?.alias || 'anon')}" data-url="${(chat?.url || '')}" style="display:${(isTop ? 'block' : 'hidden')};">
						 	${superChatStr}
						</div>`
					);
					chatDiv.append(this.createFollowLink(chat.alias, isMe, isFree), '&nbsp;&nbsp;', this.createUserPageLink(chat.alias), '&nbsp;&nbsp;', this.contentPreview(chat.chat_content, chat.chat_id));
					chatDiv.append(this.reactDiv(chat.chat_id, chat.date_submitted, chat?.sender_crypto_wallets));
					// check if cross post
					if (chat.thread_id != threadId) {
						const shortURL = chat.url.length < 30 ? chat.url : chat.url.substring(0, 30) + '...';
						chatDiv.addClass('cross_post').removeClass('my_chat').removeClass('superchat').prepend(
							`<br>
							 <a href="${chat.url}" title="${chat.url}" class="cross_post_ext_link">${shortURL}</a>
							 <br>
							 <span class="xpost_info">X-Post from thread ${chat.thread_id}</span>
							 <br>`
						);
					}
	
					// placement
					if (chat.reply_to_id == 0 && chat.thread_id == threadId) { // top chat
						chatDiv.find('.reply_link').remove();
						$('#main_thread_chat').append(chatDiv);
					} else { // regular chat
						const myReplyContainer = $(`<div class="reply_container" data-chat-id="${chat.chat_id}"></div>`);
						chatDiv.append(myReplyContainer); // MY reply container, add replies to me here.
						const parentReplyContainer = $(`.reply_container[data-chat-id="${chat.reply_to_id}"]`); // THEIR reply container
						const myChildren = $(`.chat[data-reply-to-id="${chat.chat_id}"]`);
						if (parentReplyContainer.length > 0) { // put me in my parent's container
							chatDiv.css({ paddingRight: '0' });
							parentReplyContainer.append(chatDiv);
						} else { // add me to the main thread
							$('#gui').append(chatDiv);
						}
						if (myChildren.length > 0) { // detach and move all stray children from #gui to myReplyContainer. Sometimes chats load out of order from server.
							myChildren.each((i, el) => {
								myReplyContainer.append($(el).detach());
							});
						}
					}
				});
	
				// add reply count based on how many chats are in each reply_container
				$('.chat').each((i, el) => {
					const reply_container = $(el).find('.reply_container');
					const reply_count = reply_container.children().length;
					$(el).find('.chat_reply_count').text(reply_count);
	
					// blur functionality (when not in modMode)
					const reply_to_id = $(el).attr('data-reply-to-id');
					if (reply_to_id) {
						const myChatParent = $(`.my_chat[data-id="${reply_to_id}"]`);
						if (myChatParent.length) $(el).addClass('is_reply_to_me'); // user can blur this chat even if not in modMode
					}
				});

				this.applyBlurSetting(); // apply blur setting to all chats
	
				const newMsgPlur = this.newMessages == 1 ? '' : 's';
				$('#new_msg_indicator').empty().append(this.newMessages > 0 ? `&nbsp;|&nbsp;${this.newMessages} New Message${newMsgPlur}` : '');
				this.updateReactions(data?.reactions);
	
				// scroll to btm of thread_container
				if (startMode) {
					if (this.forwardedChatID && $(`.chat[data-id="${this.forwardedChatID}"]`).length > 0) {
						this.skipAutoScroll = true;
						// scroll to the forwarded chat
						$(`.chat[data-id="${this.forwardedChatID}"]`).get(0).scrollIntoView({ behavior: "smooth", block: "center" });
					} else {
						this.skipAutoScroll = false;
						$('#scroll_to_bottom_container').slideDown(300);
					}
				}
				if (!this.skipAutoScroll) this.scrollDown();
				this.cleanUpTimeInfo();
	
				$('#thread_id_indicator').empty().append(this.getCurrentThreadID());
				$('#exit_thread_container').css({ display: 'block' });
			})
			.catch(error => {
				this.feed('There has been a problem with your fetch operation. See console.', true);
				console.error(error);
			})
			.finally(() => {
				$('.hidden_chat').removeClass('hidden_chat').slideDown(300);
				// show user the change in balance
				if (this.transactionCaptcha) {
					this.skipFeed = true;
					this.redeemInvoice(this.transactionCaptcha);
				}
				this.midRequest = false;
				const chatCount = $('.chat').length;
				$('#ext_search').attr('placeholder', `Search ${chatCount} Chat${(chatCount == 1 ? '' : 's')}...`);
			});
	}

	loadThreadSorters(){
		try{
			const threadSortMode 		= this.state.threadSortMode? this.state.threadSortMode + '': 'date_desc'; // i.e. date_desc, likes_asc, etc.
			const divSorterContainer 	= $('.thread_sorter_container');
			divSorterContainer.empty();
			const sortUpIcon 		= this.heroicon('chevron-up') || '⬆️';
			const sortDownIcon 		= this.heroicon('chevron-down') || '⬇️';
			const upDownIcon		= this.heroicon('chevron-up-down') || '-';
			var dateSorterIcon		= threadSortMode == 'date_desc'? sortDownIcon: upDownIcon;
				dateSorterIcon		= threadSortMode == 'date_asc'? sortUpIcon: dateSorterIcon;
			var likesSorterIcon		= threadSortMode == 'likes_desc'? sortDownIcon: upDownIcon;
				likesSorterIcon		= threadSortMode == 'likes_asc'? sortUpIcon: likesSorterIcon;
			var chatsSorterIcon		= threadSortMode == 'chats_desc'? sortDownIcon: upDownIcon;
				chatsSorterIcon		= threadSortMode == 'chats_asc'? sortUpIcon: chatsSorterIcon;
			var dislikesSorterIcon	= threadSortMode == 'dislikes_desc'? sortDownIcon: upDownIcon;
				dislikesSorterIcon	= threadSortMode == 'dislikes_asc'? sortUpIcon: dislikesSorterIcon;
			const dateSorter 		= $(`<a href="#" class="thread_sorter${(threadSortMode.startsWith('date')? ` active`: ``)}" data-sort-mode="date"><span class="thread_sorter_icon">${dateSorterIcon}</span> Date</a>`);
			const likesSorter 		= $(`<a href="#" class="thread_sorter${(threadSortMode.startsWith('likes')? ` active`: ``)}" data-sort-mode="likes"><span class="thread_sorter_icon">${likesSorterIcon}</span> Likes</a>`);
			const dislikesSorter	= $(`<a href="#" class="thread_sorter${(threadSortMode.startsWith('dislikes')? ` active`: ``)}" data-sort-mode="dislikes"><span class="thread_sorter_icon">${dislikesSorterIcon}</span> Dislikes</a>`);
			const chatsSorter 		= $(`<a href="#" class="thread_sorter${(threadSortMode.startsWith('chats')? ` active`: ``)}" data-sort-mode="chats"><span class="thread_sorter_icon">${chatsSorterIcon}</span> Chats</a>`);
			divSorterContainer.append(dateSorter,'&nbsp;&nbsp;',chatsSorter,'&nbsp;&nbsp;',likesSorter,'&nbsp;&nbsp;',dislikesSorter);
			$('.thread_sorter').off().on('click', (event) => {
				event.preventDefault();
				const target 		= $(event.currentTarget);
				var newSortMode 	= $(event.currentTarget).attr('data-sort-mode'); // i.e. date, likes, or chats
				const oldSortMode 	= this.state.threadSortMode? this.state.threadSortMode + '': 'date_desc'; // i.e. date_desc, likes_asc, etc.
				if(!newSortMode || typeof newSortMode != 'string' || newSortMode.length < 1) return;
				if(oldSortMode.startsWith(newSortMode)){
					newSortMode = oldSortMode.endsWith('desc')? `${newSortMode}_asc`: `${newSortMode}_desc`;
				}else{
					newSortMode = `${newSortMode}_desc`;
				}
				this.state.threadSortMode = newSortMode + '';
				this.saveState();
				this.sortThreads();
			});
		}catch(e){
			console.error(e);
		}
	}

	sortThreads(){
		try{
			const threadSortMode = this.state.threadSortMode? this.state.threadSortMode + '': 'date_desc'; // i.e. date_desc, likes_asc, etc.
			$('.waiting_to_sort').removeClass('waiting_to_sort');
			$('.thread_sorter').removeClass('active');
			switch(threadSortMode){
				case 'date_desc':
					$('.thread').sort((a, b) => {
						const aDate = $(a).attr('data-thread-id') || 0;
						const bDate = $(b).attr('data-thread-id') || 0;
						return (aDate < bDate)? 1: -1;
					}).appendTo('#gui');
					break;
				case 'date_asc':
					$('.thread').sort((a, b) => {
						const aDate = $(a).attr('data-thread-id') || 0;
						const bDate = $(b).attr('data-thread-id') || 0;
						return (aDate < bDate)? -1: 1;
					}).appendTo('#gui');
					break;
				case 'likes_desc':
					$('.thread').sort((a, b) => {
						const aLikes = $(a).attr('data-like-count') || 0;
						const bLikes = $(b).attr('data-like-count') || 0;
						return (aLikes < bLikes)? 1: -1;
					}).appendTo('#gui');
					break;
				case 'likes_asc':
					$('.thread').sort((a, b) => {
						const aLikes = $(a).attr('data-like-count') || 0;
						const bLikes = $(b).attr('data-like-count') || 0;
						return (aLikes < bLikes)? -1: 1;
					}).appendTo('#gui');
					break;
				case 'dislikes_desc':
					$('.thread').sort((a, b) => {
						const aDislikes = $(a).attr('data-dislike-count') || 0;
						const bDislikes = $(b).attr('data-dislike-count') || 0;
						return (aDislikes < bDislikes)? 1: -1;
					}).appendTo('#gui');
					break;
				case 'dislikes_asc':
					$('.thread').sort((a, b) => {
						const aDislikes = $(a).attr('data-dislike-count') || 0;
						const bDislikes = $(b).attr('data-dislike-count') || 0;
						return (aDislikes < bDislikes)? -1: 1;
					}).appendTo('#gui');
					break;
				case 'chats_desc':
					$('.thread').sort((a, b) => {
						const aChats = $(a).attr('data-chat-count') || 0;
						const bChats = $(b).attr('data-chat-count') || 0;
						return (aChats < bChats)? 1: -1;
					}).appendTo('#gui');
					break;
				case 'chats_asc':
					$('.thread').sort((a, b) => {
						const aChats = $(a).attr('data-chat-count') || 0;
						const bChats = $(b).attr('data-chat-count') || 0;
						return (aChats < bChats)? -1: 1;
					}).appendTo('#gui');
					break;
				default:;
			}
			setTimeout(()=>{
				this.loadThreadSorters();
			},100);
		}catch(e){
			console.error(e);
		}
	}
	
	getThreads(url_arg = null){
		if(this.paused) return;
		if(this.threadLocked){
			this.waitingURL = url_arg;
			return;
		}
		$('#main_thread_chat').empty();
		$('#chat_input').val('').trigger('input');
		if(url_arg){
			this.updateCurrentUserURL(url_arg);
		}
		const url = this.getCurrentURL();

		const ignore_prefixes = ['chrome://','file://','about:','data:','javascript:','view-source:','chrome-extension://'];
		for(var i=0; i<ignore_prefixes.length; i++){
			if(url.startsWith(ignore_prefixes[i])){
				this.feed('This URL is not supported.', true);
				return;
			}
		}

		this.allThreadChatIds = [];
		this.midRequest = true;

		// Check if the conversion rates are current within the last minute (also fetches notifications)
		const secondsSinceEpoch = Math.round(new Date().getTime() / 1000);
		const timeSinceConvUpdate = secondsSinceEpoch - this.convUpdatedAt;
		if(timeSinceConvUpdate > 60) this.updateConversionRates();

		this.lastThreadLoaded = null;
		this.loadingMsg('Fetching Threads');
		$('#chat_input').attr('placeholder','Create a new thread on this page...');
		this.setCurrentCaptchaFromSelector();
		this.setCurrentThreadID(null);
		this.clearChatCloneContainer();
		$('#scroll_to_bottom_container').add('#exit_thread_container').add('#create_thread_options').add('#spend_form').css('display','none');
		if(!url){
			this.feed("No URL to fetch threads for.", true);
			return;
		}
		// send this to the get_threads endpoint
		const server_url = this.getSetting('server_url');
		if(!server_url){
			this.feed("No server URL set.", true);
			return;
		}
		const getThreadsURL = `${server_url}/get_threads`;
		const formData = new FormData();
		formData.append('captcha_id', this.currentCaptcha);
		formData.append('secret', this.getInvoiceSecret(this.currentCaptcha));
		formData.append('url', url);
		fetch(getThreadsURL, {
				method: 'POST',
				body: formData
			})
			.then(response => {
				if (response.ok) {
					return response.text();
				} else {
					throw new Error('Network response was not ok');
				}
			})
			.then(json => {
				$('#gui').empty();
				// remove chats that might render late due to slow server response.
				setTimeout(function(){
					$('#gui').find('.chat').remove();
				},100);
				const data = typeof json == 'string'? JSON.parse(json): json;
				if(!data || typeof data != 'object'){
					this.feed('Server response parse failed.', true);
					return;
				}
				if (data.error) {
					this.feed(`${data.error}`, true);
					return;
				}
				this.feed(data.msg);

				// show site thread count
				const tree_count = data?.tree_count || 0;
				if(tree_count > 0){
					$('#tree_count').empty().append(tree_count);
					$('#tree_count_container').css({display: 'inline'});
				}else{
					$('#tree_count_container').css({display: 'none'});
				}

				const threads = data.threads;
				if(!threads || !Array.isArray(threads) || threads.length < 1){
					$('#gui').append('<h1 style="opacity:0.7;padding:10px;font-weight:300;font-style:italic;"><br><br><img style="display:inline-block;height:1em;" src="images/icon-128.png">&nbsp;Be the first to create a thread on this page!</h1>');
					return;
				}

				// thread sorting
				const divSorterContainer = $('<div class="thread_sorter_container"></div>'); // top of gui
				$('#gui').append(divSorterContainer);
				this.loadThreadSorters(); // load the sorters

				// rendering the threads
				const server_url = this.getSetting('server_url');
				const hide_free_threads = this.getSetting('hide_free_threads');
				threads.forEach( thread => {
					const isMe = thread?.is_me || false;
					const isFree = thread?.is_free || false;
					if(hide_free_threads && isFree) return; // Do not add free threads if setting is enabled
					const threadDiv = $(`<div class="thread${(isFree? ' free_thread': '')}${(isMe? ' my_thread': '')} waiting_to_sort" data-chat-id="${thread.chat_id}" data-thread-id="${thread.thread_id}"><strong class="chat_info">${thread.thread_id}</strong>&nbsp;&nbsp;</div>`);
					threadDiv.append(this.createFollowLink(thread.alias, isMe, isFree),'&nbsp;&nbsp;',this.createUserPageLink(thread.alias));
					if(server_url && thread.alias && thread.alias.startsWith('$')){
						const channelURL  = (thread.channel && typeof thread.channel == 'string')? `${server_url}/u/${thread.alias}/${thread.channel}`: '';
						const channelLink = thread.channel? `<span class="chat_info pull-right">in&nbsp;<a href="${channelURL}" target="_blank">${thread.channel}</a></span>`: '';
						threadDiv.append(channelLink);
					}
					threadDiv.append('<br>');
					
					const password_xml = thread.password_required? this.heroicon('lock-closed') + '&nbsp;': '';
					// const loadThreadLink = $(
					// 	`<a class="thread_opener" data-thread-id="${thread.thread_id}">
					// 		<span style="font-size:9px;opacity:0.6;">
					// 			<strong style="color:grey;">Thread ${thread.thread_id}</strong><span class="pull-right">${password_xml}</span>
					// 		</span><br>
					// 		<span>${thread.chat_content}</span>
					// 	</a>`
					// );
					const contentDiv = this.contentPreview(thread.chat_content,thread.chat_id,thread.thread_id);
					if(thread.password_required) contentDiv.find('.thread_opener').addClass('password_required');
					threadDiv.append(contentDiv);
					threadDiv.append(this.reactDiv(thread.chat_id, thread.chat_date_submitted, thread?.sender_crypto_wallets, true));
					const reply_count = threadDiv.find('.chat_reply_count');
					if(reply_count && thread?.comment_count){
						reply_count.empty().append(`${thread.comment_count}`);
					}else{
						reply_count.empty().append('0');
					}

					$('#gui').append(threadDiv);
				});
				this.updateReactions(data?.reactions);
				// scroll to btm of thread_container
				$('#gui').scrollTop(0);
				// trigger click of this.forwardedThreadID if any
				if(this.forwardedThreadID && $(`.thread_opener[data-thread-id="${this.forwardedThreadID}"]`).length > 0){
					$(`.thread_opener[data-thread-id="${this.forwardedThreadID}"]`).trigger('click');
					this.forwardedThreadID = null;
				}
				this.sortThreads(); // sort the threads based on the current sort mode.
			})
			.catch(error => {
				this.feed('There has been a problem with your fetch operation. See console.', true);
				console.trace(error);
			})
			.finally(() => {
				this.midRequest = false;
				const threadCount = $('.thread').length;
				$('#ext_search').attr('placeholder',`Search ${threadCount} Thread${( threadCount == 1? '': 's')}...`);
				$('#chat_input').focus();
			});
	}

	buildUrlHierarchy(urls) {
		// Sort URLs by length, shortest first
		urls.sort((a, b) => a.length - b.length);

		const urlMap = new Map(); // URL to node reference
		const root = {};

		for (const url of urls) {
			if (!url || typeof url != 'string') continue; // invalid URL
			let parent = null;

			// Look for the longest prefix that is already in the map
			for (const parent_candidate of urlMap.keys()) {
				const candidate = parent_candidate.replace(/\/$/, ''); // remove trailing slash
				if (url.startsWith(candidate) && url !== candidate) {
					const urlBalance 	= url.replace(candidate, ''); // needs to start with /, ?, &, #, etc.
					const firstChar 	= urlBalance.length > 0? urlBalance.charAt(0): '';
					if (firstChar == '/' || firstChar == '?' || firstChar == '&' || firstChar == '#'){
						parent = parent_candidate;
					}
				}
			}

			const node = {};
			urlMap.set(url, node);

			if (parent) {
				urlMap.get(parent)[url] = node;
			} else {
				root[url] = node;
			}
		}

		return root;
	}

	createTreeDivs(arg, parentContainer = null){ // recursive function to create the tree divs for the site tree.
		var is_top = false;
		if(!parentContainer){
			parentContainer = $('#gui'); // jquery object expected.
			const exitIcon = this.heroicon('x-mark') || '❌';
			const exitLink = $(`<a href="#" class="exit_to_thread pull-right" id="exit_site_tree">${exitIcon} Close</a>`);
			exitLink.on('click', (e) => {
				e.preventDefault();
				this.getThreads();
			});
			parentContainer.empty().append('&nbsp;',exitLink,'<br><br>');
			is_top = true; // top level tree div
		}
		if(!arg || typeof arg != 'object') return; // invalid
		const nodeCount = Object.keys(arg).length;
		const countSpan = parentContainer.find('.tree_child_part_count').first();
		var parentURL 	= parentContainer.attr('data-url') || null;
			parentURL 	= parentURL? parentURL.replace(/\/$/, ''): null; // remove trailing slash
		if(countSpan && countSpan.length > 0 && nodeCount > 0){
			countSpan.text(nodeCount).removeClass('faded').addClass('error'); // update the count of child parts
		}
		for(var key in arg){
			var showURL   	= parentURL? '' + key.replace(parentURL,''): key + ''; // parent URL parts
				showURL		= showURL.replace('https://','').replace('http://','') + ''; // remove http(s)
			const o 		= arg[key];
			const threads 	= this.currentTree[key] || null;
			const trdCount 	= threads? threads.length: 0;
			if(trdCount < 1) continue; // no threads in this part, skip it.
			const treeDiv 	= $(
				`<div class="tree_part${(is_top? ' top_part': '')}" data-url="${key}">
					<a href="${key}" class="tree_part_link" target="_blank">${showURL}</a>
					<br>
					&nbsp;
					<a class="pull-right tree_part_opener" href="#">
						<span class="tree_child_part_count"></span>
						&nbsp;
						<span class="tree_child_thread_count">${trdCount}</span>
						&nbsp;
						<span class="tree_part_opener_icon">
							${this.heroicon('chevron-down')}
						</span>
					</a>
				 </div>`
			);
			parentContainer.append(treeDiv); // append the tree div to the parent container
			treeDiv.find('.tree_part_opener').on('click', (e) => { // show all cild tree parts.
				e.preventDefault();
				e.stopPropagation();
				const target 		= $(e.currentTarget);
				if(target.hasClass('top_part')) return; // never collapse the top part
				const childParts 	= target.parent().children('.tree_part');
				const childThreads 	= target.parent().children('.tree_thread');
				const childCount 	= childParts.length + childThreads.length;
				const childrenVis 	= childParts.filter(':visible').length + childThreads.filter(':visible').length;
				if (childrenVis < childCount) {
					childParts.removeClass('search_hide').removeClass('search_show'); // show all hidden children
					childThreads.removeClass('search_hide').removeClass('search_show'); // show all hidden threads
					childParts.slideDown(200); // show all hidden children
					childThreads.slideDown(200); // show all hidden threads
					target.find('.tree_part_opener_icon').empty().append(this.heroicon('chevron-up')); // change icon to up arrow
				} else {
					childParts.removeClass('search_hide').removeClass('search_show'); // hide all visible children
					childThreads.removeClass('search_hide').removeClass('search_show'); // hide all visible threads
					childParts.slideUp(200); // hide all visible children
					childThreads.slideUp(200); // hide all visible threads
					target.find('.tree_part_opener_icon').empty().append(this.heroicon('chevron-down')); // change icon to down arrow
				}
			});
			for(var i = 0; i < threads.length; i++){
				const title 		= threads[i]?.thread_title || null;
				const author		= threads[i]?.thread_author || null;
				const channel   	= threads[i]?.channel || null;
				const thread_id 	= threads[i]?.thread_id || null;
				if(!thread_id || !author || !title) continue; // invalid thread, skip it.
				const channelURL 	= (channel && typeof channel == 'string')? 	`${this.getSetting('server_url')}/u/${author}/${channel}`: null;
				const channelLink 	= (channel && channelURL)? 					`<span class="chat_info pull-right">&nbsp;in&nbsp;<a href="${channelURL}" target="_blank">${channel}</a></span>`: '';
				const authorLink 	= (author && author.startsWith('$'))? 		`<a href="${this.getSetting('server_url')}/u/${author}" target="_blank">${author}</a>`: author;
				const threadDiv = $(
					`<div class="tree_thread" data-thread-id="${thread_id}">
						<strong class="chat_info">
							${thread_id}
						</strong>&nbsp;
						<span class="chat_info">${authorLink}</span>${channelLink}
						<br>
						<span class="chat_info">${title}</span>
					 </div>`
				);
				threadDiv.append(this.createFollowLink(threads[i].alias, threads[i].is_me, threads[i].is_free),'&nbsp;&nbsp;',this.createUserPageLink(threads[i].alias));
				treeDiv.append(threadDiv); // append the thread div to the tree div
			}
			if(key == this.getCurrentURL()){
				treeDiv.addClass('current_url'); // highlight the current URL
				// show each parent div in the hierarchy
				treeDiv.parents('.tree_part').addClass('current_url_stack'); // show all parents of this div
			}
			// recursive call to create the subparts
			this.createTreeDivs(o, treeDiv); // pass the treeDiv as the parent container for subparts
		}

		// display all top_part divs and all that contain .current_url element at any level.
		if($('.current_url').length > 0){
			setTimeout(function(){
				$('#gui').scrollTop(0); // scroll to the top of the gui container
				$('.current_url').get(0).scrollIntoView({ behavior: "smooth", block: "center" }); // scroll to the current URL div
			},200);
		}

		setTimeout(function(){
			const treePartCount = $('.tree_part').length;
			const treeThreadCount = $('.tree_thread').length;
			$('#ext_search').attr('placeholder', `Search ${treePartCount} URL${(treePartCount == 1 ? '' : 's')} or ${treeThreadCount} thread${(treeThreadCount == 1 ? '' : 's')}...`);
		},100);
	}

	loadSiteTree(){ // show the hierarchy of threads for the WEBSITE (base url) at current URL.
		$('#nav_dropdown').slideUp(200); // hide the nav dropdown if open.
		this.currentTree = {};
		$('#gui').empty().append('<h1 style="opacity:0.7;padding:10px;font-weight:300;font-style:italic;"><br><br><img style="display:inline-block;height:1em;" src="images/icon-128.png">&nbsp;Loading Site Tree...</h1>');
		const server_url = this.getSetting('server_url');
		if(!server_url || typeof server_url != 'string' || !server_url.startsWith('http')) return;
		const siteTreeURL = `${server_url}/url_thread_tree`;
		const formData = new FormData();
		formData.append('url', this.getCurrentURL());
		formData.append('captcha_id', this.getSelectedWalletID());
		formData.append('secret', this.getInvoiceSecret(this.getSelectedWalletID()));
		fetch(siteTreeURL, {
			method: 'POST',
			body: formData
		})
		.then(response => {
			if (response.ok) {
				return response.text();
			} else {
				throw new Error('Network response was not ok');
			}
		})
		.then(json => {
			const data = typeof json == 'string'? JSON.parse(json): json;
			if(!data || typeof data != 'object'){
				this.feed('Server response parse failed.', true, null, true);
				return;
			}
			if (data.error) {
				this.feed(data.error, true, null, true);
				return;
			}
			this.feed(data.msg);
			this.currentTree = data?.url_threads || {};
			if(this.currentTree && typeof this.currentTree == 'object' && Object.keys(this.currentTree).length > 0){
				const treeKeys = Object.keys(this.currentTree);
				this.createTreeDivs(this.buildUrlHierarchy(treeKeys)); // create the tree divs from the hierarchy
			}else{
				this.feed("No threads found for this website.", true, null, true);
				return;
			}
		})
		.catch(error => {
			this.feed('There has been a problem with your fetch operation. See console.', true, null, true);
			console.error(error);
		})
		.finally(() => {
			this.midRequest = false;
			$('#chat_input').focus();
		});
	}

	// Update settings
	updateSettings(newSettings) {
		let validSettings = {};
		let invalidParams = [];
		for (let key in newSettings) {
			if (this.settingsSchema[key]){
				if(typeof newSettings[key] === this.settingsSchema[key]){
					validSettings[key] = newSettings[key];
				}else if(this.settingsSchema[key] === 'number' && !isNaN(newSettings[key]*1)){
					if (key in this.settingsLimits){
						const settingLimits = this.settingsLimits[key];
						if (!Array.isArray(settingLimits) || settingLimits.length !== 2) continue;
						validSettings[key] = newSettings[key] < settingLimits[0]? settingLimits[0]: newSettings[key];
						validSettings[key] = newSettings[key] > settingLimits[1]? settingLimits[1]: newSettings[key];
					}else{
						validSettings[key] = newSettings[key]*1;
					}
				}else if(this.settingsSchema[key] === 'boolean' && ["true","false"].indexOf(newSettings[key].toString().toLowerCase()) > -1){
					validSettings[key] = newSettings[key].toString().toLowerCase() === 'true'? true: false;
				}else{
					invalidParams.push(key);
				}
			}else{
				invalidParams.push(key);
			}
		}
	
		if(invalidParams.length > 0){
			const invStr = invalidParams.join(', ');
			this.feed(`Invalid setting or type for parameter(s): ${invStr}`,true);
		}else{
			this.state.settings = { ...this.state.settings, ...validSettings }; // merge partial settings with existing settings
			this.saveState();
			this.feed("Settings updated.")
		}
	}

	getSetting(key){
		if('settings' in this.state && this.state.settings && typeof this.state.settings == 'object' && key in this.state.settings){
			return this.state.settings[key];
		}
		return this.settingsDefault[key] || null;
	}

	getCurrentURL() {
		const url = this.state.current_user_url;
		if(!url || typeof url != 'string') return null;
		return url.trim();
	}
	
	getShortURL(){
		const url_len 	= this.getSetting('url_preview_max_len');
		const url 		= this.getCurrentURL();
		var shortUrl 	=  url.substr(0,url_len);
		return url.length > url_len? shortUrl + "...": url + "";
	}

	// GUI Output
	updateCurrentUserURL(url, save_state = true) {
		const server_url = this.getSetting('server_url');
		url = url.toString();
		if(server_url && typeof server_url == 'string' && url.startsWith(server_url + '/chat_forwarding')){ // check for chat_forwarding
			try{
				const urlParams = new URLSearchParams(url.split('?')[1]);
				const cid 		= urlParams.get('cid');
				const tid		= urlParams.get('tid');
				if(cid && !isNaN(cid*1) && tid && !isNaN(tid*1)){
					this.forwardedChatID 	= cid*1;
					this.forwardedThreadID 	= tid*1;
					// Close the formContainer so that the user can see the chat that they are being forwarded to
					$('#nav-close').trigger('click');
				}
			}catch(e){
				console.error(e);
				return;
			}
		}
		// Update the state of the app
		this.state.current_user_url = url;
		$('#current_url').attr('title',this.getCurrentURL()).empty().append(this.getShortURL());
		if(save_state) this.saveState();
	}

	updateCurrentMetadata(metadata){
		this.state.currentMetadata = (metadata && typeof metadata == 'object')? JSON.parse(JSON.stringify(metadata)): {};
		this.saveState();
	}

	displayConversionRates(){
		var conversion_strings = [];
		const show_conv = this.getSetting('show_conversions');
		for(var i=0; i<this.conversionRates.length; i++){
			try{
				const conv = this.conversionRates[i];
				const pair = conv?.currencyPair;
				if(!pair || typeof pair != 'string' || show_conv.indexOf(pair) < 0) continue;
				const code = conv?.code;
				const cryp = conv?.cryptoCode;
				const csym = this.cryptoSymbol(cryp);
				const rate = conv?.rate;
				const symb = this.fiatCodeToSymbol(code);
				const prc  = rate? rate.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }): null;
				if(prc) conversion_strings.push(`${csym}&nbsp;${symb}${prc}`);
			}catch(e){
				console.error(e);
				continue;
			}
		}
		$('#conversion_rate').empty().append(conversion_strings.join('&nbsp;&nbsp;&nbsp;<span style="opacity:0.4;">|</span>&nbsp;&nbsp;&nbsp;'));
	}

	fetchNotifications(){
		const server_url 		= this.getSetting('server_url');
		if(!server_url || typeof server_url != 'string' || !server_url.startsWith('http')) return;
		const notificationURL 	= `${server_url}/notifications`;
		const formData 			= new FormData();
		const captcha_id	 	= this.getSelectedWalletID();
		if(!captcha_id || !(captcha_id in this.state.invoices)) return; // User may not have selected a wallet yet.
		const invoice 			= this.state.invoices?.[captcha_id] || null;
		if(!invoice || typeof invoice != 'object') return;

		// tell the server how long ago you want notifications for
		const nowSeconds 		= Math.floor(Date.now() / 1000); // time since epoch in seconds
		const notifsFetchedAt 	= invoice?.notifsFetchedAt || 0; // time since epoch in seconds
		const getNotifsInterval = (!isNaN(notifsFetchedAt*1) && notifsFetchedAt > 60)? Math.floor(nowSeconds - notifsFetchedAt): 2_629_800; // difference in seconds, max 30 days
		formData.append('captcha_id', captcha_id);
		formData.append('seconds', getNotifsInterval); // server expects seconds since last fetch, not seconds since epoch
		formData.append('secret', this.getInvoiceSecret(captcha_id));

		fetch(notificationURL, {
			method: 'POST',
			body: formData
		})
		.then(response => {
			if (response.ok) {
				return response.text();
			} else {
				throw new Error('Network response was not ok');
			}
		})
		.then(json => {
			const data = typeof json == 'string'? JSON.parse(json): json;
			if(!data || typeof data != 'object'){
				this.feed('Server response parse failed.', true);
				return;
			}
			if (data.error) {
				this.feed(data.error, true);
				return;
			}
			const captcha_id 	= this.getSelectedWalletID();
			if(!captcha_id || !(captcha_id in this.state.invoices)) return; // User may not have selected a wallet yet.
			const invoice 		= this.state.invoices?.[captcha_id] || null;
			if(!invoice || typeof invoice != 'object') return;
			invoice.newThreads 	= Array.isArray(invoice.newThreads)? invoice.newThreads: [];
			invoice.newReplies 	= Array.isArray(invoice.newReplies)? invoice.newReplies: [];
			var new_threads 	= data?.new_threads || [];
				new_threads 	= Array.isArray(new_threads)? JSON.parse(JSON.stringify(new_threads)): [];
			var new_replies 	= data?.new_replies || [];
				new_replies 	= Array.isArray(new_replies)? JSON.parse(JSON.stringify(new_replies)): [];
			var ignore_ids		= invoice?.notifsIgnoreIDs || [];
				ignore_ids		= Array.isArray(ignore_ids)? ignore_ids: [];
			var new_trd_count	= 0,
				new_rpy_count	= 0;
			for(var i=0; i<new_threads.length; i++){
				const nt = new_threads[i];
				const nt_id = nt?.id; // chat id
				// Ignore this thread if it is in the ignore list
				if(!nt_id || isNaN(nt_id*1) || ignore_ids.indexOf(nt_id*1) > -1) continue;
				// Add this to this.newThreads if it is not already there
				var duplicate_found = false;
				for(var j=0; j<invoice.newThreads.length; j++){
					if(invoice.newThreads[j].id == nt_id){
						duplicate_found = true;
						break;
					}
				}
				if(duplicate_found) continue;
				invoice.newThreads.push(nt);
				new_trd_count++;
			}
			for(var i=0; i<new_replies.length; i++){
				const nr = new_replies[i];
				const nr_id = nr?.id; // chat id
				// Ignore this reply if it is in the ignore list
				if(!nr_id || isNaN(nr_id*1) || ignore_ids.indexOf(nr_id*1) > -1) continue;
				const tr_id = nr?.thread_id; // thread id
				// Ignore this reply if it is in the thread that is open.
				const current_thread_id = this.getCurrentThreadID();
				if(current_thread_id && current_thread_id == tr_id){
					// mark this notification as read
					const captcha_id = this.getSelectedWalletID();
					const invoice = this.state.invoices?.[captcha_id] || null;
					if(!invoice || typeof invoice != 'object') return;
					invoice.notifsIgnoreIDs = invoice.notifsIgnoreIDs || [];
					invoice.notifsIgnoreIDs.push(nr_id*1);
					this.saveState();
				}
				// Add this to invoice.newReplies if it is not already there
				var duplicate_found = false;
				for(var j=0; j<invoice.newReplies.length; j++){
					if(invoice.newReplies[j].id == nr_id){
						duplicate_found = true;
						break;
					}
				}
				if(duplicate_found) continue;
				invoice.newReplies.push(nr);
				new_rpy_count++;
			}
			this.updateNotifCount(captcha_id);
			invoice.notifsFetchedAt = nowSeconds;
			this.saveState();
		})
		.catch(error => {
			this.feed('Failed to fetch notifications.', true);
			console.error(error);
		});
	}

	updateNotifCount(captcha_id){
		var total_notifs = 0;
		const invoice = this.state.invoices?.[captcha_id] || null;
		if(invoice && typeof invoice == 'object'){
			invoice.newThreads 		= Array.isArray(invoice.newThreads)? invoice.newThreads: [];
			invoice.newReplies 		= Array.isArray(invoice.newReplies)? invoice.newReplies: [];
			var ignore_ids			= invoice?.notifsIgnoreIDs || [];
				ignore_ids			= Array.isArray(ignore_ids)? ignore_ids: [];
			// get non-ignored ids
			const new_thread_ids 	= invoice.newThreads.map(nt => nt.id).filter(id => ignore_ids.indexOf(id*1) < 0);
			const new_reply_ids 	= invoice.newReplies.map(nr => nr.id).filter(id => ignore_ids.indexOf(id*1) < 0);
			total_notifs 			= new_thread_ids.length + new_reply_ids.length;
		}
		$('#notification_count').empty().append(total_notifs.toString());
		if(total_notifs > 0){
			$('#notifications_opener').removeClass('faded');
		}else{
			$('#notifications_opener').addClass('faded');
		}
	}

	updateConversionRates(){ // TODO: Update this so it uses BTC -OR- the crypto code of the current wallet.
		this.loadWalletSelector(); // Load on startup just in case the server doesn't respond. If the wallets aren't loaded into the selector, users cannot post.
		if(this.paused) return;
		const server_url = this.getSetting('server_url');
		if(!server_url || typeof server_url != 'string' || !server_url.startsWith('http')) return;
		const conversionRateURL = `${server_url}/static/btc_rate_current.json`;
		this.convUpdatedAt = Math.floor(Date.now() / 1000); // time since epoch in seconds
		$.get(conversionRateURL, (data) => {
			if(!data || !Array.isArray(data) || data.length < 1){
				this.feed('Array min length of 1 expected for conversion rates.', true);
				return;
			}
			this.conversionRates = data;
			this.displayConversionRates();
			this.loadWalletSelector();
			this.fetchNotifications();
		});
	}

	// NOTE: In CatsUpNorth jargon, satoshi is the smallest unit of a bitcoin OR other crypto (could be stand in for piconero, etc.)
	// The satsFactor function handles smallest unit conversions for different cryptos.
	// The `crypto_code` argument in other functions is used to determine the conversion factor for the specific crypto.
	satsFactor(crypto_code = 'BTC'){
		var factor = 100_000_000; // satoshis per bitcoin
		switch(crypto_code){
			case 'XMR': factor = 1_000_000_000_000; break; // piconero per monero
			default:;
		}
		return factor;
	}

	cryptoSymbol(crypto_code = 'BTC'){
		var symbol = this.heroicon('btc') || '₿';
		switch(crypto_code){
			case 'XMR': symbol = this.heroicon('xmr') || 'XMR'; break;
			default:;
		}
		return symbol;
	}

	satoshiToCrypto(satoshi, crypto_code = 'BTC'){
		if(isNaN(satoshi*1) || satoshi < 1 || satoshi % 1 > 0) return 0;
		return satoshi / this.satsFactor(crypto_code);
	}

	cryptoToSatoshi(crypto_amount, crypto_code = 'BTC'){
		if(isNaN(crypto_amount*1)) return 0;
		return Math.floor(crypto_amount * this.satsFactor(crypto_code));
	}

	cryptoToFiatStr(crypto_amount, crypto_code = 'BTC'){
		const fiat_code 	= this.getSetting('fiat_code');
		const curr_char		= this.fiatCodeToSymbol(fiat_code);
		const sats 			= this.cryptoToSatoshi(crypto_amount,crypto_code);
		const fiat_amount 	=this.satoshiToFiat(sats,crypto_code).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
		return `${curr_char}${fiat_amount}`;
	}

	fiatToSatoshi(fiat_amount, crypto_code = 'BTC', altFiatCode = null){
		if(isNaN(fiat_amount*1)) return 0;
		var fiat_code = this.getSetting('fiat_code');
		if(altFiatCode && typeof altFiatCode == 'string' && altFiatCode.length === 3){
			fiat_code = altFiatCode;
		}
		const rate = this.conversionRates.find(rate => rate.code === fiat_code && rate.cryptoCode === crypto_code);
		if(!rate || !rate.rate || isNaN(rate.rate*1)) return 0;
		const crypto_amount = fiat_amount / rate.rate;
		const sats = this.cryptoToSatoshi(crypto_amount, crypto_code);
		return sats;
	}

	satoshiToFiat(satoshi, crypto_code = 'BTC', altFiatCode = null){
		if(isNaN(satoshi*1) || satoshi % 1 > 0) return 0;
		var fiat_code = this.getSetting('fiat_code');
		if(altFiatCode && typeof altFiatCode == 'string' && altFiatCode.length === 3){
			fiat_code = altFiatCode;
		}
		const rate = this.conversionRates.find(rate => rate.code === fiat_code && rate.cryptoCode === crypto_code);
		if(!rate || !rate.rate || isNaN(rate.rate*1)) return 0;
		const fiat_amount = (satoshi / this.satsFactor(crypto_code)) * rate.rate;
		return fiat_amount;
	}

	fiatToCryptoStr(fiat_amount, crypto_code = 'BTC'){
		return this.satoshiToCrypto(this.fiatToSatoshi(fiat_amount,crypto_code)) + " " + this.cryptoSymbol(crypto_code);
	}

	fiatToSatoshiStr(fiat_amount, cryptp_code = 'BTC'){
		return this.fiatToSatoshi(fiat_amount,cryptp_code);
	}

	satoshiToCryptoStr(satoshi, crypto_code = 'BTC'){
		return this.satoshiToCrypto(satoshi,crypto_code) + " " + this.cryptoSymbol(crypto_code);
	}

	satoshiToFiatStr(satoshi, crypto_code = 'BTC'){
		const fiat_code 	= this.getSetting('fiat_code');
		if (!fiat_code) return "---";
		const curr_char		= this.fiatCodeToSymbol(fiat_code);
		var curr_accuracy 	= 2; // TODO: Add special cases for certain fiat codes
		return curr_char + this.satoshiToFiat(satoshi,crypto_code).toLocaleString(undefined, { minimumFractionDigits: curr_accuracy, maximumFractionDigits: curr_accuracy });
	}

	// the last two currency functions do not need a crypto_code argument because they are fiat only
	fiatStrFormatted(fiat_amount){
		const fiat_code = this.getSetting('fiat_code');
		if (!fiat_code) return "---";
		const curr_char		= this.fiatCodeToSymbol(fiat_code);
		var curr_accuracy 	= 2; // TODO: Add special cases for certain fiat codes
		return curr_char + fiat_amount.toLocaleString(undefined, { minimumFractionDigits: curr_accuracy, maximumFractionDigits: curr_accuracy });
	}
	fiatCodeToSymbol(fiat_code){
		var curr_char 		= fiat_code + '';
		switch(fiat_code){
			case 'USD': curr_char = '$'; break;
			case 'EUR': curr_char = '€'; break;
			case 'GBP': curr_char = '£'; break;
			case 'JPY': curr_char = '¥'; break;
			case 'AUD': curr_char = 'A$'; break;
			case 'CAD': curr_char = 'C$'; break;
			case 'CHF': curr_char = 'Fr'; break;
			case 'CNY': curr_char = 'CN¥'; break;
			case 'SEK': curr_char = 'kr'; break;
			case 'NZD': curr_char = 'NZ$'; break;
			case 'KRW': curr_char = '₩'; break;
			case 'SGD': curr_char = 'S$'; break;
			case 'NOK': curr_char = 'kr'; break;
			case 'MXN': curr_char = 'Mex$'; break;
			case 'HKD': curr_char = 'HK$'; break;
			case 'TRY': curr_char = '₺'; break;
			case 'RUB': curr_char = '₽'; break;
			case 'INR': curr_char = '₹'; break;
			case 'BRL': curr_char = 'R$'; break;
			case 'ZAR': curr_char = 'R'; break;
			case 'IDR': curr_char = 'Rp'; break;
			case 'MYR': curr_char = 'RM'; break;
			case 'PHP': curr_char = '₱'; break;
			case 'THB': curr_char = '฿'; break;
			case 'VND': curr_char = '₫'; break;
			case 'PLN': curr_char = 'zł'; break;
			case 'TWD': curr_char = 'NT$'; break;
			case 'SAR': curr_char = 'ر.س'; break;
			case 'AED': curr_char = 'د.إ'; break;
			case 'CZK': curr_char = 'Kč'; break;
			case 'CLP': curr_char = 'CLP$'; break;
			case 'ILS': curr_char = '₪'; break;
			case 'KES': curr_char = 'KSh'; break;
			case 'PKR': curr_char = '₨'; break;
			case 'QAR': curr_char = 'QR'; break;
			case 'HUF': curr_char = 'Ft'; break;
			case 'EGP': curr_char = 'E£'; break;
			case 'COP': curr_char = 'COL$'; break;
			case 'ARS': curr_char = 'AR$'; break;
			case 'DOP': curr_char = 'RD$'; break;
			case 'CRC': curr_char = '₡'; break;
			case 'PEN': curr_char = 'S/.'; break;
			case 'UYU': curr_char = '$U'; break;
			case 'BOB': curr_char = 'Bs'; break;
			case 'PYG': curr_char = '₲'; break;
			case 'DKK': curr_char = 'kr'; break;
			case 'ISK': curr_char = 'ikr'; break;
			case 'RON': curr_char = 'lei'; break;
			case 'BGN': curr_char = 'лв'; break;
			case 'MAD': curr_char = 'د.م.'; break;
			case 'ZMW': curr_char = 'ZK'; break;
			case 'BHD': curr_char = '.د.ب'; break;
			case 'OMR': curr_char = 'ر.ع.'; break;
			case 'JOD': curr_char = 'د.ا'; break;
			case 'TND': curr_char = 'د.ت'; break;
			case 'LBP': curr_char = 'ل.ل'; break;
			case 'GHS': curr_char = '₵'; break;
			case 'NGN': curr_char = '₦'; break;
			case 'ETB': curr_char = 'Br'; break;
			case 'TZS': curr_char = 'TSh'; break;
			case 'MUR': curr_char = '₨'; break;
			case 'UGX': curr_char = 'USh'; break;
			case 'DZD': curr_char = 'د.ج'; break;
			case 'VUV': curr_char = 'VT'; break;
			case 'FJD': curr_char = 'FJ$'; break;
			case 'PGK': curr_char = 'K'; break;
			case 'XOF': curr_char = 'CFA'; break;
			case 'XAF': curr_char = 'CFA'; break;
			case 'KZT': curr_char = '₸'; break;
			case 'GEL': curr_char = '₾'; break;
			default:;
		}
		return curr_char;
	}

	getConversionPairs(){
		var conversion_pairs = [];
		for(var i=0; i<this.conversionRates.length; i++){
			const conv = this.conversionRates[i];
			const pair = conv?.currencyPair;
			if(pair && typeof pair == 'string' && pair.length > 0){
				conversion_pairs.push(pair);
			}
		}
		return conversion_pairs;
	}
	
	buildSettingsForm() {
        $('#nav-close').show(300);
		$('#form_container').empty().append('<h2>Extension Settings</h2>');

		// Create
		const cancelIcon = this.heroicon('x-mark') || '❌';
		const buyFormCancel = $(`<a href="#" id="cancel_buy_wallet" class="pull-right faded" title="Cancel Wallet Creation">${cancelIcon}&nbsp;Cancel</a>`);
		buyFormCancel.on('click', (e) => {
			e.preventDefault();
			$('.buy_form_container').slideUp(200);
		});

		// Get alpha sorted keys from this.state.settings
		const sortedKeys = Object.keys(this.settingsDefault).sort();

		const settingsForm = $(`<form></form>`);

        for (var i=0; i<sortedKeys.length; i++) {
			const key  	= sortedKeys[i];

            var input 		= null;
			const desc 		= this.settingsDescriptions?.[key] || null;
			var label 		= `<label for="${key}" title="${(desc? desc: '')}">${key.replace(/_/g, ' ').toUpperCase()}</label>`;
            if (key == 'font_size') { // font size dropdown
				input 			= $(`<select name="font_size" title="${(desc? desc: '')}"></select>`);
				const options 	= ['0.5em','0.6em','0.7em','0.8em','0.9em','1em','1.1em','1.2em','1.3em','1.4em','1.5em'];
				const dflt		= this.state.settings?.[key] || this.settingsDefault?.[key] || null;
				for(var j=0; j<options.length; j++){
					const opt 		= options[j];
					const selected 	= dflt == opt? ' selected': '';
					input.append(`<option value="${opt}"${selected}>${opt}</option>`);
				}
			} else if(key == 'blur_setting') {
				input 			= $(`<select name="blur_setting" title="${(desc? desc: '')}"></select>`);
				const options 	= ['show','blur','hide'];
				const dflt		= this.state.settings?.[key] || this.settingsDefault?.[key] || null;
				for(var j=0; j<options.length; j++){
					const opt 		= options[j];
					const selected 	= dflt == opt? ' selected': '';
					input.append(`<option value="${opt}"${selected}>${opt}</option>`);
				}
			} else if (typeof this.settingsDefault[key] === 'boolean') { // checkbox
				label			= null;
				const is_true 	= key in this.state.settings? this.state.settings[key]: this.settingsDefault[key];
				const checked 	= is_true? ' checked': '';
				input 			= `<input type="checkbox" title="${(desc? desc: '')}" name="${key}"${checked}>&nbsp;<label for="${key}" title="${(desc? desc: '')}">${key.replace(/_/g, ' ').toUpperCase()}</label><br>`;
            } else if(Array.isArray(this.settingsDefault[key])){ // checkboxes
				input 			= $(`<div style="font-size:0.8em;" class="checkbox_group" name="${key}"></div>`);
				var checkbox_options = [];
				switch(key){
					case 'show_conversions':
						checkbox_options = this.getConversionPairs();
						break;
					default:;
				}
				for(var j=0; j<checkbox_options.length; j++){
					const opt 		= checkbox_options[j];
					const checked 	= this.state.settings?.[key]?.includes(opt)? ' checked': '';
					const checkbox 	= $(`<input type="checkbox" title="${(desc? desc: '')}" name="${key}" value="${opt}"${checked}>`);
					checkbox.prop('checked',this.state.settings?.[key]?.includes(opt) || false);
					input.append(checkbox,opt,'<br>');
				}
				input.append('<br>');
			} else {
                const typ 	= typeof this.settingsDefault[key] === 'number' ? 'number' : 'text';
				const val 	= this.state.settings?.[key] || this.settingsDefault[key];
				input 		= $(`<input type="${typ}" title="${(desc? desc: '')}" name="${key}" value="${val}">`);
            }
			if(!input) continue; // skip if no input
			if(label) settingsForm.append(label,'<br>');
            settingsForm.append(input,'<br>');
			
			if(key == 'server_url'){
				// Get all server_urls from invoices in this.state.invoices
				var server_urls = [];
				var v = this.state.settings?.[key] || this.settingsDefault[key];
				for (let name in this.state.invoices) {
					if(this.state.invoices[name].server_url && typeof this.state.invoices[name].server_url == 'string' && this.state.invoices[name].server_url.length > 0 && this.state.invoices[name].server_url != v){
						server_urls.push(this.state.invoices[name].server_url);
					}
				}
				// Make server_urls unique and alpha sorted
				server_urls = [...new Set(server_urls)].sort();
				// Add a button to set the input value to each of the available server_urls
				server_urls.forEach(server_url => {
					const urlset = $(`<a data-url="${server_url}">Set to ${server_url}</a>`);
					urlset.on('click', (e) => {
						e.preventDefault();
						const target = $(e.currentTarget);
						const server_url = target.data('url');
						$('input[name="server_url"]').val(server_url);
					});
					settingsForm.append(urlset,'<br>');
				});
				settingsForm.append('<br>');
			}
        }

		// append submit button
		settingsForm.append(`<br><br><input type="submit" value="Save Settings"><br><br>`);
		settingsForm.on('submit', (e) => {
			e.preventDefault();
			for(var key in this.settingsDefault){
				const input = settingsForm.find(`[name="${key}"]`);
				if(input.length < 1) continue;
				const val = input.val();
				if(Array.isArray(this.settingsDefault[key])){
					const checkedBoxes = input.find('input[type="checkbox"]:checked');
					const checkedValues = [];
					checkedBoxes.each((i, el) => {
						checkedValues.push($(el).val());
					});
					this.updateSettings({[key]: checkedValues});
				}else if(this.settingsSchema?.[key] == 'boolean'){
					this.updateSettings({[key]: input.is(':checked')});
				}else{
					this.updateSettings({[key]: val});
				}
			}
			this.saveState();
			this.updateConversionRates();
			this.applyFontSizeSetting();
			$('#nav-close').trigger('click');
		});
		$('#form_container').append(settingsForm);
		$('#form_container').slideDown(200);
    }

	urlAutoThreadAutoChat(url, thread_id = 0, chat_id = 0){
		if(!url || typeof url != 'string' || url.length < 1) return;
		if(!thread_id || isNaN(thread_id*1) || thread_id < 1) return;
		const hasQuery 		= url.indexOf('?') > -1;
		const querySymbol 	= hasQuery? '&': '?';
		var newURL = `${url}${querySymbol}catsupnorthautothreadid=${thread_id}`;
		if(newURL.endsWith('?') || newURL.endsWith('&')) newURL = newURL.slice(0,-1);
		if(chat_id && !isNaN(chat_id*1) && chat_id > 0){
			newURL += `&catsupnorthautochatid=${chat_id}`;
		}
		return newURL;
	}

	renderNotification(o,target_jquery_object, typ){
		try{
			const server_url = this.getSetting('server_url');
			if(!server_url || typeof server_url != 'string' || !server_url.startsWith('http')) throw new Error('No server URL set.');
			const short_url = o.url.length > 30? o.url.substr(0,30) + '...': o.url;
			var channel 	= o.channel? `<span class="chat_info pull-right">in&nbsp;${o.channel}</span>`: '';
			var alias 		= o.name? `<span class="chat_info">${o.name}</span>`: '';
			if(o.name && o.name.startsWith('$')){
				alias = `<span class="chat_info"><a href="${server_url}/u/${o.name}" target="_blank">${o.name}</a></span>`;
				channel = o.channel? `<span class="chat_info pull-right">in&nbsp;<a href="${server_url}/u/${o.name}/${o.channel}">${o.channel}</a></span>`: '';
			}
			const xMark = this.heroicon('x-mark') || '❌';
			target_jquery_object.append(`<div class="notification-${typ}" data-chat-id="${o.id}" style="border-top:1px solid rgba(125,125,125,0.4);">
				<a href="${server_url}/chat_forwarding?cid=${o.id}" title="${o.url}" target="_blank">${short_url}</a><br>
				${o.content}<br>
				${alias}${channel}
				<a href="#" style="opacity:0.7;font-style:italic;font-size:0.7em;" class="pull-right error mark_notif_read" data-id="${o.id}" data-type="${typ}">${xMark} mark as read</a>
			</div>`);
		}catch(e){
			console.error(e);
		}
	}

	buildNotificationsForm() {
		const captcha_id 	= this.getSelectedWalletID();
		if(!captcha_id || !(captcha_id in this.state.invoices)) return; // User may not have selected a wallet yet.
		const invoice 		= this.state.invoices?.[captcha_id] || null;
		if(!invoice || typeof invoice != 'object') return;
		$('#new_replies_div').add('#new_threads_div').add('#notif_replies_link').add('#notif_threads_link').empty();
		$('#nav_dropdown').css('display','block');
		$('.internal_nav').css('display','none');
		$('#form_container').empty().show();
		$('#nav-close').show();
		const repliesCount	= invoice.newReplies.length;
		const threadsCount	= invoice.newThreads.length;
		const notifCount 	= repliesCount + threadsCount;
		if(notifCount < 1){
			$('#form_container').append('<h2>No New Notifications</h2>');
			$('#form_container').show();
			return;
		}
		const newThreadsDiv = $(`<div id="new_threads_div" style="display:none;"></div>`);
		const newRepliesDiv = $(`<div id="new_replies_div" style="display:none;"></div>`);
		const threadsLink	= $(`<a href="#" id="notif_threads_link" style="opacity:0.7;font-size:1.2em;font-weight:600;"><span id="notif_threads_link_count"></span> Thread${( threadsCount == 1? '': 's' )}</a>`);
		const repliesLink	= $(`<a href="#" id="notif_replies_link" style="opacity:0.7;font-size:1.2em;font-weight:600;"><span id="notif_replies_link_count"></span> Repl${( repliesCount == 1? 'y': 'ies' )}</a>`);
		const xMark			= this.heroicon('x-mark') || '❌';
		const repliesRead	= $(`<a href="#" id="mark_all_read" style="opacity:0.7;font-style:italic;font-weight:600;" class="pull-right error mark_notif_read" data-id="*" data-type="replies">${xMark} Mark All Read</a>`);
		const threadsRead	= $(`<a href="#" id="mark_all_read" style="opacity:0.7;font-style:italic;font-weight:600;" class="pull-right error mark_notif_read" data-id="*" data-type="threads">${xMark} Mark All Read</a>`);
		newRepliesDiv.append(`New replies to your chats.`,repliesRead,'<br><br>');
		newThreadsDiv.append(`New threads from users that<br>you follow.`,threadsRead,'<br><br>');
		threadsLink.on('click', (e) => {
			e.preventDefault();
			this.state.notifsMode = 'threads';
			$('#notif_threads_link').css({opacity:'1'});
			$('#notif_replies_link').css({opacity:'0.7'});
			$('#new_replies_div').hide();
			$('#new_threads_div').show();
		});
		repliesLink.on('click', (e) => {
			e.preventDefault();
			this.state.notifsMode = 'replies';
			$('#notif_replies_link').css({opacity:'1'});
			$('#notif_threads_link').css({opacity:'0.7'})
			$('#new_threads_div').hide();
			$('#new_replies_div').show();
		});
		var ignoreIDs = invoice?.notifsIgnoreIDs || [];
			ignoreIDs = Array.isArray(ignoreIDs)? ignoreIDs: [];
		var actualRepliesCount 	= 0,
			actualThreadsCount 	= 0,
			actualNotifsCount 	= 0;
		for(var i=0; i<repliesCount; i++){
			if(ignoreIDs.indexOf(invoice.newReplies[i].id) > -1) continue;
			this.renderNotification(invoice.newReplies[i],newRepliesDiv,'replies');
			actualRepliesCount++;
		}
		for(var i=0; i<threadsCount; i++){
			if(ignoreIDs.indexOf(invoice.newThreads[i].id) > -1) continue;
			this.renderNotification(invoice.newThreads[i],newThreadsDiv,'threads');
			actualThreadsCount++;
		}
		actualNotifsCount = actualRepliesCount + actualThreadsCount;
		const bell_icon = this.heroicon('bell') || '🔔';
		$('#form_container').append(`<h2>${bell_icon} ${actualNotifsCount} Notification${( actualNotifsCount == 1? '': 's' )}</h2>`);
		$('#form_container').append(threadsLink,'&nbsp;&nbsp;|&nbsp;&nbsp;',repliesLink,'<br><br>',newRepliesDiv,newThreadsDiv);
		$('#notif_threads_link_count').empty().append(actualThreadsCount);
		$('#notif_replies_link_count').empty().append(actualRepliesCount);
		if(this.state.notifsMode == 'threads'){
			threadsLink.trigger('click');
		}else if(this.state.notifsMode == 'replies'){
			repliesLink.trigger('click');
		}else{
			if(threadsCount > 0){
				threadsLink.trigger('click'); // sets this.state.notifsMode to 'threads'
			}else{
				repliesLink.trigger('click'); // sets this.state.notifsMode to 'replies'
			}
		}
		$('.mark_notif_read').on('click', (e) => {
			e.preventDefault();
			const targ 			= $(e.currentTarget);
			const id 			= targ.attr('data-id');
			const typ   		= targ.attr('data-type');
			const captcha_id 	= this.getSelectedWalletID();
			if(!captcha_id || !(captcha_id in this.state.invoices)) return; // User may not have selected a wallet yet.
			const invoice 		= this.state.invoices?.[captcha_id] || null;
			if(!invoice || typeof invoice != 'object') return;
			invoice.notifsIgnoreIDs = Array.isArray(invoice.notifsIgnoreIDs)? invoice.notifsIgnoreIDs: [];
			if(id == '*'){ // ignore all of this type.
				$(`.notification-${typ}`).each(function(){
					const nid = $(this).attr('data-chat-id');
					if(nid && !isNaN(nid*1)) invoice.notifsIgnoreIDs.push(nid*1);
				});
			}else if(!isNaN(id*1)){
				invoice.notifsIgnoreIDs.push(id*1);
			}
			invoice.notifsIgnoreIDs = [...new Set(invoice.notifsIgnoreIDs)];
			this.saveState();
			this.buildNotificationsForm();
		});
		this.updateNotifCount(captcha_id);
	}

	buildChannelList(){
		$('#form_container').empty();

		var myVerifiedUsernames = {};
		for (let name in this.state.invoices) {
			if(this.state.invoices[name].alias && typeof this.state.invoices[name].alias == 'string' && this.state.invoices[name].alias.startsWith('$')){
				myVerifiedUsernames[name] = {
					alias: this.state.invoices[name].alias,
					crypto_currency: this.state.invoices[name].crypto_currency
				}
			}
		}

		if(myVerifiedUsernames.length < 1){ // User not eligible to create channels
			$('#form_container').append('<h2>No verified usernames found. Get a verified username to create channels.</h2>');
			return;
		}
	
		$('#form_container').append('<h2>My Verified Usernames</h2>');
		for(let k in myVerifiedUsernames){
			const aliasLink = $(
				`<a class="get_my_channels_link" data-wallet-id="${k}" data-alias="${myVerifiedUsernames[k].alias}" data-crypto-currency="${myVerifiedUsernames[k].crypto_currency}">
					${myVerifiedUsernames[k].alias}
				</a>`
			);
			aliasLink.on('click', (e) => {
				e.preventDefault();
				this.channelCaptchaCache = $(e.currentTarget).attr('data-wallet-id');
				this.channelCryptoCache = $(e.currentTarget).attr('data-crypto-currency');
				this.channelAliasCache = myVerifiedUsernames[this.channelCaptchaCache].alias;
				$('#form_container').empty().append('<h2>Fetching Channels...</h2>');
				const targ = $(e.currentTarget);
				const walletID = targ.attr('data-wallet-id');
				const server_url = this.getSetting('server_url');
				if(!server_url || typeof server_url != 'string' || !server_url.startsWith('http')){
					this.feed('No server URL set.', true);
					return;
				}
				const getChannelsEndpoint 	= `${server_url}/get_my_channels`;
				const formData = new FormData();
				formData.append('captcha_id', walletID);
				formData.append('secret', this.getInvoiceSecret(walletID));
				fetch(getChannelsEndpoint, {
					method: 'POST',
					body: formData
				})
				.then(response => {
					if (response.ok) {
						return response.text();
					} else {
						throw new Error('Network response was not ok');
					}
				})
				.then(json => {
					$('#form_container').empty();
					const data = typeof json == 'string'? JSON.parse(json): json;
					if(!data || typeof data != 'object'){
						this.feed('Server response parse failed.', true);
						return;
					}
					if (data.error) {
						this.feed(`${data.error}`, true);
						return;
					}
					this.feed(data.msg);
					const channels = data.channels;
					if(!channels || !Array.isArray(channels) || channels.length < 1){
						$('#form_container').append('<h3>No channels found.</h3>');
					}
					const server_url = this.getSetting('server_url');
					if(!server_url || typeof server_url != 'string' || !server_url.startsWith('http')){
						this.feed('No server URL set.', true);
						return;
					}
					$('#form_container').append('<h2>My Channels</h2>');
					channels.forEach( channel => {
						const channelDiv = $('<div class="channel" style="margin-bottom:10px;width:100%;border-top:1px solid rgba(255,255,255,0.4);"></div>');
						const channelIcon = this.heroicon('rectangle-group') || '👥';
						channelDiv.append(`<h2><a href="${server_url}/u/${this.channelAliasCache}/${channel.channel}" target="blank">${channelIcon} ${channel.channel}</a></h2>`);
						// Widgets
						const pollLink 		= $(`<a href="#" class="channel_polls_link" data-channel="${channel.channel}" data-alias="${this.channelAliasCache}">Polls</a>`);
						const settingsLink 	= $(`<a href="#" class="channel_settings_link" data-channel="${channel.channel}" data-alias="${this.channelAliasCache}">Settings</a>`);
						pollLink.on('click', (e) => {
							e.preventDefault();
							const targ = $(e.currentTarget);
							const channel = targ.attr('data-channel');
							const alias = targ.attr('data-alias');
							const targetForm = $('.channel_polls_form[data-channel="'+channel+'"][data-alias="'+alias+'"]');
							$('.channel_polls_form').not(targetForm).css('display','none');
							$('.channel_settings_from').css('display','none');
							$('.existing_polls[data-channel="'+channel+'"][data-alias="'+alias+'"]').empty().append('Fetching Polls...').slideDown(200);
							targetForm.slideToggle(200);
							// Fetch existing polls
							const server_url = this.getSetting('server_url');
							if(!server_url || typeof server_url != 'string' || !server_url.startsWith('http')){
								this.feed('No server URL set.', true);
								return;
							}
							const getPollsEndpoint = `${server_url}/get_poll_titles_for_channel`; // actually a post endpoint
							const formData = new FormData();
							formData.append('channel', channel);
							formData.append('captcha_id', this.channelCaptchaCache);
							formData.append('verified_name', alias);
							fetch(getPollsEndpoint, {
								method: 'POST',
								body: formData
							})
							.then(response => {
								if (response.ok) {
									return response.text();
								} else {
									throw new Error('Network response was not ok');
								}
							})
							.then(json => {
								const data = typeof json == 'string'? JSON.parse(json): json;
								const cont = $('.existing_polls[data-channel="'+channel+'"][data-alias="'+alias+'"]');
								cont.empty();
								if(!data || typeof data != 'object'){
									this.feed('Server response parse failed.', true, cont);
									return;
								}
								if (data.error) {
									this.feed(`${data.error}`, true, cont);
									return;
								}
								if(!data.poll_titles || !Array.isArray(data.poll_titles) || data.poll_titles.length < 1){
									cont.append('No polls found.', cont);
									return;
								}
								const poll_titles = data?.poll_titles || [];
								for(var i=0; i<poll_titles.length; i++){
									const poll = poll_titles[i];
									if(!poll || typeof poll != 'string') continue
									const url_save_poll_name = poll.replace(/ /g,'_').replace(/[^a-zA-Z0-9_]/g,'');
									const pollLink = $(`<a href="${server_url}/u/${alias}/${channel}?poll=${url_save_poll_name}" target="_blank">${poll}</a>`);
									cont.append(pollLink,'<br>');

								}
							})
							.catch(error => {
								this.feed('There has been a problem with your fetch operation. See console.', true);
								console.trace(error);
							});

						});
						settingsLink.on('click', (e) => {
							e.preventDefault();
							const targ = $(e.currentTarget);
							const channel = targ.attr('data-channel');
							const alias = targ.attr('data-alias');
							const targetForm = $('.channel_settings_from[data-channel="'+channel+'"][data-alias="'+alias+'"]');
							$('.channel_polls_form').css('display','none');
							$('.channel_settings_from').not(targetForm).css('display','none');
							targetForm.slideToggle(200);
						});

						const pollForm 		= $(
							`<form class="channel_polls_form" data-channel="${channel.channel}" data-alias="${this.channelAliasCache}" style="display:none;">
								<h4>Existing Polls</h4>
								<div class="existing_polls" data-channel="${channel.channel}" data-alias="${this.channelAliasCache}"></div>
								<h4>Create a New Poll</h4>
								<input type="hidden" name="channel" value="${channel.channel}">
								<input type="hidden" name="captcha_id" value="${this.channelCaptchaCache}">
								<label for="date_end">
									<details>
										<summary>Poll End Date</summary>
										<p>Enter the date that the poll will end. Users can vote on the poll until this date.</p>
									</details>
								</label>
								<input type="date" name="date_end" required>
								<br><br>
								<label for="poll_title">
									<details>
										<summary>Poll Question</summary>
										<p>Enter the question for your poll. Any user can create threads at the poll URL to create entries to be voted on. Users vote on threads by upvoting them. *Add an asterisk to the start of a poll to lock it so that only your threads show up in the poll.</p>
									</details>
								</label>
								<input type="text" name="poll_title" placeholder="Poll Question" required>
								<br>
								<input type="submit" value="Create Poll">
								<br><br>
							</form>`
						);
						pollForm.on('submit', (e) => {
							e.preventDefault();
							const formData = new FormData(e.target);
							const walletID = formData.get('captcha_id');
							const dateVal  = formData.get('date_end');
							// convert dateVal to one that the python server can understand
							// user_date = datetime.strptime(date_end, '%a, %d %b %Y %H:%M:%S %Z')
							const dateObj = new Date(dateVal);
							const dateStr = dateObj.toUTCString();
							formData.set('date_end', dateStr);
							formData.append('secret', this.getInvoiceSecret(walletID));
							formData.append('verified_name',this.channelAliasCache);
							const server_url = this.getSetting('server_url');
							if(!server_url || typeof server_url != 'string' || !server_url.startsWith('http')){
								this.feed('No server URL set.', true);
								return;
							}
							const createPollEndpoint = `${server_url}/create_poll`;
							fetch(createPollEndpoint, {
								method: 'POST',
								body: formData
							})
							.then(response => {
								if (response.ok) {
									return response.text();
								} else {
									throw new Error('Network response was not ok');
								}
							})
							.then(json => {
								const data = typeof json == 'string'? JSON.parse(json): json;
								if(!data || typeof data != 'object'){
									this.feed('Server response parse failed.', true);
									return;
								}
								if (data.error) {
									this.feed(`${data.error}`, true);
									return;
								}
								this.feed(data.msg);
							})
							.catch(error => {
								this.feed('There has been a problem with your fetch operation. See console.', true);
								console.trace(error);
							})
							.finally(() => {
								$('.channel_polls_form').each(function(){
									$(this).slideUp(200,function(){
										$(this).find('input[type="date"]').val('');
										$(this).find('input[type="text"]').val('');
										$(this).find('.existing_polls').empty();
									});
								});
							});

						});
						// Settings
						const channelForm = $(
							`<form class="channel_settings_from" data-channel="${channel.channel}" data-alias="${this.channelAliasCache}" style="display:none;">
								<h4>Channel Settings <span style="color:rgb(255,100,100);font-style:italic;"><br>PREMIUM FEATURES COMING SOON!</span></h4>
								<input type="hidden" name="channel" value="${channel.channel}">
								<input type="hidden" name="captcha_id" value="${this.channelAliasCache}">
								<input type="hidden" name="date_end" value="0">
								<input type="checkbox" name="premium_flag" class="channel_premium_flag" value="1" ${channel.premium_flag? 'checked': ''}> Premium Channel
								<br>
								<div class="premium_settings" style="display:${channel.premium_flag? 'block': 'none'};">
									<br>
									<label for="premium_satoshi_threshold">
										<details>
											<summary>Premium Sats Threshold</summary>
											<p>Set the minimum amount of sats (or piconero) required to access this channel.</p>
										</details>
									</label>
									<input type="number" step="1" min="0" class="premium_satoshi_threshold" name="premium_satoshi_threshold" value="${channel.premium_satoshi_threshold || ''}">
									<div class="premium_sat_as_fiat" style="display:${channel.premium_satoshi_threshold? 'block': 'none'};">
										${this.satoshiToFiatStr(channel.premium_satoshi_threshold,this.channelCryptoCache)}
									</div>
									<br>
									<br>
									<label for="premium_day_threshold">
										<details>
											<summary>Premium Day Threshold</summary>
											<p>This sets the number of days that users can access the channel after meeting the minimum sats threshold.</p>
										</details>
									</label>
									<input type="number" step="1" min="0" name="premium_day_threshold" value="${channel.premium_day_threshold || ''}">
								</div>
								<br>
								<input type="submit" value="Save Channel Settings" style="display:none;">
								<br><br>
							</form>`
						);
						channelForm.find('.channel_premium_flag').on('change', (e) => {
							const targ = $(e.currentTarget);
							const submit_button = targ.parent().find('input[type="submit"]');
							submit_button.slideDown(200);
							const premium_settings = targ.parent().find('.premium_settings');
							if(targ.is(':checked')){
								premium_settings.slideDown(200);
							}else{
								premium_settings.slideUp(200);
								// Clear the threshold values
								targ.parent().find('.premium_satoshi_threshold').val('');
								targ.parent().find('.premium_day_threshold').val('');
								targ.parent().find('.premium_sat_as_fiat').empty().hide();
							}
						});
						channelForm.find('.premium_satoshi_threshold').on('input', (e) => {
							const targ = $(e.currentTarget);
							var val = targ.val();
								val = (!isNaN(val*1) && val*1)? val*1: 0;
							const fiat_display = targ.parent().find('.premium_sat_as_fiat');
							fiat_display.empty().append(this.satoshiToFiatStr(val,this.channelCryptoCache));
							fiat_display.slideDown(200);
						});
						channelForm.on('submit', (e) => {
							e.preventDefault();
							const formData = new FormData(e.target);
							const walletID = formData.get('captcha_id');
							var satsThreshold = formData.get('premium_satoshi_threshold');
								satsThreshold = (!isNaN(satsThreshold*1) && satsThreshold*1)? satsThreshold*1: 0;
							var daysThreshold = formData.get('premium_day_threshold');
								daysThreshold = (!isNaN(daysThreshold*1) && daysThreshold*1)? daysThreshold*1: 0;
							formData.append('update_flag_satoshi_threshold',(satsThreshold > 0)? 1: 0);
							formData.append('update_flag_day_threshold',(daysThreshold > 0)? 1: 0);
							formData.append('verified_name',this.channelAliasCache);
							formData.append('secret', this.getInvoiceSecret(walletID));
							const premiumFlag = formData.get('premium_flag');
							formData.append('premium_flag', premiumFlag? '1': '0');
							const server_url = this.getSetting('server_url');
							if(!server_url || typeof server_url != 'string' || !server_url.startsWith('http')){
								this.feed('No server URL set.', true);
								return;
							}
							const saveChannelSettingsEndpoint = `${server_url}/channel_configuration`;
							fetch(saveChannelSettingsEndpoint, {
								method: 'POST',
								body: formData
							})
							.then(response => {
								if (response.ok) {
									return response.text();
								} else {
									throw new Error('Network response was not ok');
								}
							})
							.then(json => {
								const data = typeof json == 'string'? JSON.parse(json): json;
								if(!data || typeof data != 'object'){
									this.feed('Server response parse failed.', true);
									return;
								}
								this.feed(data.msg);
							})
							.catch((error) => {
								console.error('Error:', error);
								feed('Error saving channel settings.', true);
							})
							.finally(() => {
								$('.channel_settings_from').slideUp(200);
							});
						});
						channelDiv.append(pollLink, '&nbsp;&nbsp;<span class="faded">|</span>&nbsp;&nbsp;', settingsLink, '<br>', pollForm,channelForm);
						$('#form_container').append(channelDiv);
					});
					
					const addChannelForm = $(
						`<form class="add_channel_form">
							<input type="hidden" name="captcha_id" value="${k}">
							<input type="hidden" name="verified_name" value="${myVerifiedUsernames[k].alias}">
							<h2>Create a New Channel</h2>
							<label for="channel_name">
								<details>
									<summary>Channel Name</summary>
									<p>Enter the name of your new channel. This channel will be added as a page on the public ${myVerifiedUsernames[k].alias} Page.</p>
								</details>
							</label>
							<input type="text" name="channel" required>
							<br><br>
							<input type="submit" value="Create Channel">
							<br><br>
						</form>`
					);
					addChannelForm.on('submit', (e) => {
						e.preventDefault();
						const formData = new FormData(e.target);
						const walletID = formData.get('captcha_id');
						formData.append('secret', this.getInvoiceSecret(walletID));
						const server_url = this.getSetting('server_url');
						if(!server_url || typeof server_url != 'string' || !server_url.startsWith('http')){
							this.feed('No server URL set.', true);
							return;
						}
						const createChannelEndpoint = `${server_url}/channel_configuration`;
						fetch(createChannelEndpoint, {
							method: 'POST',
							body: formData
						})
						.then(response => {
							if (response.ok) {
								return response.text();
							} else {
								throw new Error('Network response was not ok');
							}
						})
						.then(json => {
							const data = typeof json == 'string'? JSON.parse(json): json;
							if(!data || typeof data != 'object'){
								this.feed('Server response parse failed.', true);
								return;
							}
							if (data.error) {
								this.feed(`${data.error}`, true);
								return;
							}
							this.feed(data.msg);
							this.buildChannelList();
							setTimeout(this.loadChannelSelector, 1000);
						})
						.catch(error => {
							this.feed('There has been a problem with your fetch operation. See console.', true);
							console.trace(error);
						});
					});
					$('#form_container').append('<br><br>',addChannelForm);
				});
			});
			$('#form_container').append(aliasLink,'<br><br>');
		}
		if($('.get_my_channels_link').length == 1){ // no need to make user select if only one verified username
			$('.get_my_channels_link').trigger('click');
		}
		$('#form_container').slideDown(200);
	}

	loadChannelSelector(){// fetch the channels for verified users.
		$('#create_thread_channel_selector').off().empty().append('<option value="">Select Channel</option>');
		const selectedCaptcha = this.getSelectedWalletID();
		if(!selectedCaptcha || selectedCaptcha.toLowerCase().trim() == 'free') return;

		try{
			// Make sure the user is verified
			const alias = this.state.invoices[selectedCaptcha]?.alias || null;
			if(!alias || typeof alias != 'string' || !alias.startsWith('$')) return;
	
			const formData = new FormData();
			formData.append('captcha_id', selectedCaptcha);
			formData.append('secret', app.getInvoiceSecret(selectedCaptcha));
			const server_url = app.getSetting('server_url');
			if(!server_url || typeof server_url != 'string' || !server_url.startsWith('http')){
				app.feed('No server URL set.', true);
				return;
			}
			const getChannelsEndpoint = `${server_url}/get_my_channels`;
			fetch(getChannelsEndpoint, {
				method: 'POST',
				body: formData
			})
			.then(response => {
				if (response.ok) {
					return response.text();
				} else {
					throw new Error('Network response was not ok');
				}
			})
			.then(json => {
				const data = typeof json == 'string'? JSON.parse(json): json;
				if(!data || typeof data != 'object'){
					app.feed('Server response parse failed.', true);
					return;
				}
				const channels = data?.channels || [];
				const channelSelector = $('#create_thread_channel_selector');
				if(channels.length > 0){
					channelSelector.empty().append('<option>Select Channel (optional)</option>');
					channels.forEach((channel) => {
						if(!channel || typeof channel != 'object' || !channel.channel || typeof channel.channel != 'string') return;
						channelSelector.append(`<option value="${channel.channel}">${channel.channel}</option>`);
					});
					// select the first channel
					channelSelector.on('change', (e) => {
						const targ = $(e.currentTarget);
						const channel = targ.val();
						if(channel && typeof channel == 'string' && channel.length > 0){
							$('#thread_channel').val(channel);
						}
					});
					$('#my_channel_options').slideDown(200);
				}else{
					$('#my_channel_options').slideUp(200);
				}
			});
		}catch(e){
			console.error(e);
		}
	}

	getSelectedWalletID(){
		return $('#wallet_selector').val() || $('#wallet_selector').find('option').first().val();
	}

	setCurrentCaptchaFromSelector(){
		const selectedWalletID = this.getSelectedWalletID();
		if(selectedWalletID === 'free'){
			this.currentCaptcha = 'free';
		}else{
			this.currentCaptcha = selectedWalletID;
		}
		this.saveState();
	}

	loadWalletSelector(){
		const currentCaptcha		= this.currentCaptcha;
		const previouslySelected 	= $('#wallet_selector').val();
		const show_crypto_balance	= this.getSetting('show_crypto_balance');
		const show_sats_balance		= this.getSetting('show_sats_balance');
		const show_fiat_balance		= this.getSetting('show_fiat_balance');
		// sort invoices by balance in decending order
		try{
			const sortedInvoices 		= Object.keys(this.state.invoices || {}).sort((a, b) => this.state.invoices[b].balance - this.state.invoices[a].balance );
			// save user selection
			$('#wallet_selector').empty();
			const server_url 			= this.getSetting('server_url');
			for (var i=0; i<sortedInvoices.length; i++){
				const captchaId 	= sortedInvoices[i];
				const invoice 		= this.state.invoices[captchaId];
				if(invoice.server_url !== server_url) continue; // skip invoices for other servers
				if(!invoice.balance || isNaN(invoice.balance*1) || invoice.balance < 1) continue; // skip empty wallets
				var balance_strings = [];
				const crypto_code	= invoice?.crypto_currency || 'BTC';
				if(show_crypto_balance) balance_strings.push(this.satoshiToCryptoStr(invoice.balance,crypto_code) + ' ' + crypto_code);
				if(show_sats_balance) 	balance_strings.push((invoice.balance*1).toLocaleString('en-US'));
				if(show_fiat_balance) 	balance_strings.push(this.satoshiToFiatStr(invoice.balance,crypto_code));
				var captchaName 	= captchaId.substring(0, 8) + '...';
				if(invoice?.alias) captchaName = invoice.alias.toString();
				if(!show_crypto_balance) captchaName += ' - ' + crypto_code;
				const sep_str 		= '&nbsp;&nbsp;|&nbsp;&nbsp;';
				const bal_sep 		= balance_strings.length > 0? sep_str + '': '';
				const option 		= $(`<option value="${captchaId}">${captchaName}${bal_sep}${balance_strings.join(sep_str)}</option>`);
				if((currentCaptcha && currentCaptcha === captchaId) || (previouslySelected && previouslySelected === captchaId)){
					option.attr('selected', 'selected');
				}
				$('#wallet_selector').append(option);
			}
			$('#wallet_selector').append('<option value="free">Free Chat Mode (not eligible for payouts)</option>');
			if(previouslySelected){
				$('#wallet_selector').val(previouslySelected);
			}else{ // Select the first option
				$('#wallet_selector').val(sortedInvoices[0]);
			}
			$('#wallet_selector').off().on('change', (e) => {
				const targ 			= $(e.currentTarget);
				this.currentCaptcha = targ.val();
				$('#spend_input').trigger('keyup');
				$('#nav-close').trigger('click');
				this.saveState();
				$('.original_chat').remove(); // allow the original chat to re-render

				// Reload the thread or get threads again when user changes wallet
				// if(this.currentThreadID){
				// 	this.loadThread(this.currentThreadID, this.passCache, true); 
				// }else{
				// 	this.getThreads();
				// }
				// This allows the follow links to update.
				this.updateFollowList(this.currentCaptcha);
				this.updateConversionRates(); // Also fetches user's notifications
				// verified users only
				this.loadChannelSelector();
			});
			setTimeout(()=>{this.loadChannelSelector}, 150);
			setTimeout(()=>{this.setCurrentCaptchaFromSelector}, 200);
			setTimeout(()=>{this.displayConversionRates}, 250);
		}catch(e){
			console.error(e);
		}
	}

	getSelectedWalletBalance(){
		const selectedWalletID = this.getSelectedWalletID();
		if(selectedWalletID === 'free') return 0;
		return this.state.invoices[selectedWalletID]?.balance || 0;
	}

	getSelectedWalletCryptoCode(){
		const selectedWalletID = this.getSelectedWalletID();
		if(selectedWalletID === 'free') return null;
		return this.state.invoices[selectedWalletID]?.crypto_currency || 'BTC';
	}

	genBuyForm(forceCryptoCode = null){
		$('.invoice_buy_form').remove(); // remove any existing buy forms
        const buyForm 			= $(`<form class="invoice_buy_form"></form>`);
		const crytpoLabel 		= $('<label for="select-input">Crypto Currency:</label>');
		var cryptoSelect;
		if(forceCryptoCode && typeof forceCryptoCode == 'string'){
			cryptoSelect = $(`<input type="hidden" class="buy_wallet_crypto" name="select-input" value="${forceCryptoCode}" required>`);
		}else{
			cryptoSelect 		= $(`
				<select class="buy_wallet_crypto" name="select-input" required>
					<option value="BTC">BTC</option>
					<option value="XMR">XMR</option>
				</select>
			`);
			cryptoSelect.on('change', function(event){ // reset form
				event.preventDefault();
				$('.buy_wallet_val').val('').trigger('keyup');
			});
		}
		const fiatLabel 		= $('<label for="select-input">Buy Value:</label>');
		const fiatOptions 		= ['USD','CAD','EUR'];
		const fiatSelect 		= $('<select class="buy_wallet_curr" name="select-input" required></select>');
		for(let i=0; i<fiatOptions.length; i++){
			const fiatCode 		= fiatOptions[i];
			const fiatSymbol 	= this.fiatCodeToSymbol(fiatCode);
			const fiatOption 	= $(`<option value="${fiatCode}">${fiatSymbol} - ${fiatCode}</option>`);
			fiatSelect.append(fiatOption);
		}
		fiatSelect.on('change', function(event){ // reset form
			event.preventDefault();
			$('.buy_wallet_val').val('').trigger('keyup');
		});
		const buyAmountLabel 	= $('<label for="select-input">Buy Amount:</label>');
		const buyAmountInput	= $('<input type="number" class="buy_wallet_val" name="number-input" min="1" required>');
		buyAmountInput.on('keyup', (e) => {
			e.preventDefault();
			const targ 	= $(e.currentTarget);
			const v 	= isNaN(targ.val()*1)? 0: targ.val()*1;
			const fcode = $('.buy_wallet_curr').val();
			const ccode = $('.buy_wallet_crypto').val();
			const sats 	= this.fiatToSatoshi(v, ccode, fcode);
			if(sats <= 0){
				$('.buy_wallet_crypto_label').empty().append('&nbsp;');
			}else{
				$('.buy_wallet_crypto_label').empty().append(this.satoshiToCryptoStr(sats,ccode));
			}
			if(e.key === 'Enter') $('.buy_wallet_submit').trigger('click');
		});
		const buyAmountCalc  	= $('<label for="submit" class="buy_wallet_crypto_label" style="font-size:1.4em;">&nbsp;</label>');
		const submitButton 		= $('<input class="buy_wallet_submit" name="submit" type="submit" value="Create Wallet!" style="margin-top:10px;">');
		buyForm.append(crytpoLabel,cryptoSelect,fiatLabel,fiatSelect,buyAmountLabel,buyAmountInput,buyAmountCalc,submitButton);
		buyForm.submit((e) => {
			e.preventDefault();
			this.createWallet($('.buy_wallet_val').first().val(), $('.buy_wallet_curr').first().val(), $('.buy_wallet_crypto').first().val(), true);
		});
		return buyForm;
	}
	
	buildWalletForm(){
		this.currentThreadID = null;

		$('#nav_dropdown').slideUp();
		// Close link
		const closeIcon = this.heroicon('x-mark') || '❌';
		const closeLink = $(`<a href="#" id="close_wallet_list" class="pull-right faded" title="Close Wallet List" style="margin-top:10px;">${closeIcon}&nbsp;Close</a>`);
		closeLink.on('click', (e) => {
			e.preventDefault();
			this.getThreads();
		});
		$('#gui').empty().append('&nbsp;',closeLink,'<br><br>');

		// Create wallet form
		const buyFormContainer 	= $('<div class="buy_form_container" style="display:none;"></div>');
		
		const cancelIcon = this.heroicon('x-mark') || '❌';
		const buyFormCancel = $(`<a href="#" id="cancel_buy_wallet" class="pull-right faded" title="Cancel Wallet Creation">${cancelIcon}&nbsp;Cancel</a>`);
		buyFormCancel.on('click', (e) => {
			e.preventDefault();
			$('.buy_form_container').slideUp(200);
		});
        buyFormContainer.append('<hr><h2>Create a new Wallet</h2>',this.genBuyForm(),'<br>&nbsp;',buyFormCancel,'<hr>');


        // wallet list
		const h2 = $('<h2>My&nbsp;Wallets&nbsp;</h2>');
		const plus = $(`<a href="#" id="add_wallet" class="pull-right" title="Add a new wallet">${this.heroicon('plus')} New</a>`);
		plus.on('click', (e) => {
			e.preventDefault();
			$('.buy_form_container').toggle(200);
		});
		h2.append(plus);
		$('#gui').append(h2,buyFormContainer);
		
		var total_invoices = 0, server_invoices = 0;
		const date_sorted_invoice_keys = Object.keys(this.state.invoices).sort((a, b) => {
			const dateA = new Date(this.state.invoices[a].created);
			const dateB = new Date(this.state.invoices[b].created);
			return dateB - dateA;
		});
		const group_sorted_invoice_keys = date_sorted_invoice_keys.sort((a, b) => {
			const groupA = this.state.invoices[a]?.invoice_group || 0;
			const groupB = this.state.invoices[b]?.invoice_group || 0;
			return groupB - groupA;
		});
        var invoiceDivs = [];
		for (var i=0; i<group_sorted_invoice_keys.length; i++){
			var name = group_sorted_invoice_keys[i];
			total_invoices++;

			// We only want invoices for the current server
			if (this.state.invoices[name].server_url !== this.getSetting('server_url')) {
				continue;
			}

			server_invoices++;

			const invoice 		= JSON.parse(JSON.stringify(this.state.invoices[name]));
			// Create a div for each invoice
			const crypto_code 	= invoice?.crypto_currency || null;
			const crypto_symbol = this.cryptoSymbol(crypto_code);
			const inv_group 	= invoice?.invoice_group || null;
			const group_str 	= inv_group? `<span class="pull-right" style="font-weight:600;font-size:1.7em;opacity:0.4;" title="Invoice Group ID (Invoice groups allow you to accept multiple crypto currencies as tip chats).">g${inv_group}</span>`: '';
			const alias 		= invoice?.alias || null;
			const use_name      = alias? alias: name.substring(0, 8);
            const bal_class     = invoice.balance > 0? 'balance': 'no_balance';
			const invoiceDiv    = $(
                `<div class="card invoice" data-captcha-id="${name}" data-date-created="${invoice.created}" data-balance="${invoice.balance}" data-ccode="${crypto_code}">
					<span style="font-weight:900;font-size:3em;">${crypto_symbol}</span>${group_str}<br>
					<a class="invoice_server_link" href="${invoice.server_url}" target="_blank">${invoice.server_url.replace('https://','').replace('http://','')}</a><br>
					<input type="checkbox" class="wallet_checkbox" data-captcha-id="${name}" style="display:inline-block;width:auto;">
					<span class="dust_verb" data-captcha_id="${name}" style="font-style:italic;"></span>
                    <strong class="${bal_class} alias_strong" style="font-size:1.6em;">${use_name}</strong><br>
                    Rate Quote: ${invoice.rate_quote} (atomic)<br>
                    Balance: <span class="${bal_class}">${this.satoshiToCrypto(invoice.balance,invoice?.crypto_currency)} (${this.satoshiToFiatStr(invoice.balance,invoice?.crypto_currency)})</span> <span class="update_bal_container"></span><br>
                    Created: ${invoice.created}<br>
                </div>`
            );

			var repoElement = $('<span class="faded" style="text-decoration:line-through;" title="No recovery phrase found.">Recovery Phrase</span>');
			if(invoice.repo){
				repoElement = $(`<a href="#" title="Copy Recovery Phrase to clipboard" class="pull-right">${this.heroicon('clipboard-document')}&nbsp;Recovery Phrase</a>`);
				repoElement.on('click', (e) => {
					e.preventDefault();
					const targ = $(e.currentTarget);
					navigator.clipboard.writeText(invoice.repo);
					this.feed('Recovery Phrase copied to clipboard.',false,targ);
					targ.animate({opacity: 0}, 300, ()=>{ targ.animate({opacity: 1}, 300); });
				});
			}

			const redeemLink = $(`<a href="#" data-captcha-id="${name}" class="invoice_redeem_link" title="Redeem/Refresh this invoice">${this.heroicon('arrow-path')}&nbsp;<span class="verb_span">Refresh</span></a>`);
			redeemLink.click((e) => {
                e.preventDefault();
                try{
                    // empty the invoice container and add wait message
                    const click_target_parent = e.target.parentElement;
                    // lock height of parent
                    click_target_parent.style.height = click_target_parent.offsetHeight + "px";
    
                    click_target_parent.innerHTML = 'Please wait...';
    
                    // Get the captcha ID from the clicked element
    
                    this.redeemInvoice(e.target.getAttribute('data-captcha-id'));
                }catch(e){
                    this.feed(e,true);
                }
			});

			// Request payout link
			const payoutLink = $(`<a href="#" data-captcha-id="${name}" class="invoice_payout_link pull-right" title="Request a payout for this invoice">${this.heroicon('arrow-down-on-square')}&nbsp;Withdraw</a>`);
			const payoutForm = $(
				`<form class="invoice_payout_form" data-captcha-id="${name}" style="display:none;">
					<strong style="font-size:1.4em;">Request Payout</strong><br><br>
					<label for="send_to_address">Receiving Address:</label><br>
					<input type="text" name="send_to_address" placeholder="${crypto_code} Address" style="width:100%;"><br><br>
					<label for="fiat_withdraw">Amount:</label><br>
					$<input type="number" step="0.01" class="fiat_withdraw" name="fiat_withdraw" placeholder="Amount to withdraw" style="width:60%;">
					<a class="payout_max">${this.heroicon('bolt')} Max</a>
					<input type="hidden" name="captcha_id" value="${name}">
					<br><br>
					<input type="number" class="satoshi_to_withdraw" name="satoshi_to_withdraw" value="0">
					<br><br>
					<input type="submit" value="Request Payout">
					<br><br>
					&nbsp;<a class="payout_cancel faded pull-right">${this.heroicon('x-mark')} Cancel</a>
				</form>`);
			payoutLink.click((e) => {
				e.preventDefault();
				// Get the captcha ID from the clicked element
				const targ 			= $(e.currentTarget);
				const captchaId 	= targ.attr('data-captcha-id');
				const form 			= $(`.invoice_payout_form[data-captcha-id="${captchaId}"]`);
				if(form.length > 0){
					form.slideToggle(200,function(){
						$(this).find('.payout_max').off().on('click', (e) => {
							e.preventDefault();
							try{
								const inv = app.state.invoices[captchaId];
								const max = inv?.balance || 0;
								form.find('input[name="fiat_withdraw"]').val(app.satoshiToFiatStr(max,inv?.crypto_currency));
								form.find('input[name="satoshi_to_withdraw"]').val(max);
							}catch(e){
								app.feed(e,true);
							}
						});
						$(this).find('.payout_cancel').off().on('click', (e) => {
							e.preventDefault();
							$(this).slideUp(200);
						});
						$(this).find('.fiat_withdraw').off().on('keyup', (e) => {
							e.preventDefault();
							const targ = $(e.currentTarget);
							const val = targ.val();
							const inv = app.state.invoices[captchaId];
							const sats = app.fiatToSatoshi(val,inv?.crypto_currency);
							$(this).parent().find('input[name="satoshi_to_withdraw"]').val(sats);
						});
						$(this).find('.satoshi_to_withdraw').off().on('keyup', (e) => {
							e.preventDefault();
							const targ = $(e.currentTarget);
							const val = targ.val();
							const inv = app.state.invoices[captchaId];
							const fiat = app.satoshiToFiat(val,inv?.crypto_currency);
							$(this).parent().find('input[name="fiat_withdraw"]').val(fiat);
						});
						$(this).off().on('submit', (e) => {
							e.preventDefault();
							const formData = new FormData(e.currentTarget);
							const captchaId = formData.get('captcha_id');
							const secret = app.getInvoiceSecret(captchaId);
							formData.append('secret', secret);
							const server_url = app.getSetting('server_url');
							if(!server_url || typeof server_url != 'string' || !server_url.startsWith('http')){
								app.feed('No server URL set.', true);
								return;
							}
							const payoutEndpoint = `${server_url}/get_funds`;
							fetch(payoutEndpoint, {
								method: 'POST',
								body: formData
							})
							.then(response => {
								form.slideUp(200);
								if (response.ok) {
									return response.text();
								} else {
									throw new Error('Network response was not ok');
								}
							})
							.then(json => {
								const data = typeof json == 'string'? JSON.parse(json): json;
								if(!data || typeof data != 'object'){
									app.feed('Server response parse failed.', true, $(`.invoice_payout_form[data-captcha-id="${captchaId}"]`));
									return;
								}
								if(data.error){
									console.error(data);
									app.feed(data.error, true, $(`.invoice_payout_form[data-captcha-id="${captchaId}"]`));
								}else if(data.msg){
									app.feed(data.msg);
									app.redeemInvoice(captchaId);
									$('.invoice_payout_form').slideUp(300,function(){
										app.buildWalletForm();
									});
								}
							});
						});
					});
				}
			});

			const verifyLink = $(`<a href="#" class="invoice_verify_link" data-captcha-id="${name}" title="Get a verified username for this virtual wallet">&nbsp;&nbsp;${this.heroicon('pencil')}</a>`);
			verifyLink.on('click',(e) => {
				e.preventDefault();
				const targ = $(e.currentTarget);
				const captchaId = targ.attr('data-captcha-id');
				if($('.invoice_verification_form').length > 0){
					$('.invoice_verification_cancel_link').remove();
					$('.invoice_verification_form').slideUp(200, () => {
						$('.invoice_verification_form').remove();
					});
					return;
				}
				$('.invoice_verification_form').remove();
				$('.invoice_verification_cancel_link').remove();
				const cancelIcon = this.heroicon('x-mark') || '❌';
				const cancelVerificationLink = $(
					`<a href="#" class="invoice_verification_cancel_link faded pull-right" style="display:inline-block;margin-bottom:15px;margin-left:15px;">
						${cancelIcon}&nbsp;&nbsp;<span style="font-style:italic;">Cancel</span>
					</a>`
				);
				cancelVerificationLink.on('click', (e) => {
					e.preventDefault();
					$('.invoice_verification_form').slideUp(300,function(){
						$(this).remove();
					});
				});
				const verificationForm = $(
					`<form class="invoice_verification_form" data-captcha-id="${captchaId}" style="display:none;">
						<strong style="font-size:1.4em;">Get a Username!</strong><br><br>
						<select name="update_old_chats">
							<option value="Yes" selected>Update old chats and threads</option>
							<option value="No">Apply new username to new chats and threads only</option>
						</select><br><br>
						<div style="display:none;" class="previous_verified_usernames_container" data-captcha-id="${name}">
							Previous Usernames<br>
							<select name="previous_verified_usernames" data-captcha-id="${name}"><option value="0">Loading...</option></select><br><br>
						</div>
						<input type="text" name="username_submission" data-captcha-id="${name}" placeholder="New Username..." style="font-size:20px;"><br><br>
						<select class="verification_type" name="verification_type" data-captcha-id="${name}">
							<option value="nickname" selected>Free Nickname (no fee)</option>
							<option value="verified">Verified Username (pay fee)</option>
						</select><br><br>
						<div class="name_fee_desc" data-captcha-id="${name}" style="display:none;"><strong>Fee:</strong> <span class="user_verification_fee">Loading...</span><br><br></div>
						<input type="submit" value="Get New Username"><br><br>
						<strong class="error">WARNING:</strong> Assigning a username will reduce your anonymity and may affect your privacy.
					</form>`
				);
				verificationForm.append('<br><br>&nbsp;',cancelVerificationLink);

				verificationForm.on('submit', (e) => {
					e.preventDefault();
					const targ = $(e.currentTarget);
					const formData = new FormData(e.currentTarget);
					const captchaId = targ.attr('data-captcha-id');
					const secret = this.state.invoices[captchaId].secret;
					formData.append('captcha_id', captchaId);
					formData.append('secret', secret);
					const server_url = this.getSetting('server_url');
					if(!server_url || typeof server_url != 'string' || !server_url.startsWith('http')){
						this.feed('No server URL set.', true);
						return;
					}
					const verificationEndpoint 	= `${server_url}/verified_name`;
					const nickNameEndpoint 		= `${server_url}/preferred_name`;
					const verificationType 		= formData.get('verification_type');
					const useEndpoint			= verificationType == 'verified'? verificationEndpoint: nickNameEndpoint;
					const submitButton 			= targ.find('input[type="submit"]').first();
					submitButton.prop('disabled', true);
					submitButton.val('Please wait...');
					// send it
					this.transactionCaptcha = captchaId;
					fetch(useEndpoint, {
						method: 'POST',
						body: formData
					})
					.then(response => {
						if (response.ok) {
							return response.text();
						} else {
							throw new Error('Network response was not ok');
						}
					})
					.then(json => {
						const data = typeof json == 'string'? JSON.parse(json): json;
						if(!data || typeof data != 'object'){
							this.feed('Server response parse failed.', true);
							return;
						}
						if(data.error){
							this.feed(data.error, true);
						}else if(data.msg){
							this.feed(data.msg);
							const new_username = data?.new_username || null;
							if(new_username){
								const invoice = this.state.invoices?.[this.transactionCaptcha] || null;
								if(invoice){
									invoice.alias = new_username;
									this.skipFeed = true;
									this.redeemInvoice(this.transactionCaptcha);
								}else{
									this.feed('No invoice found for this captcha ID.', true);
								}
							}else{
								this.feed('No id/username pair found in server response.', true);
							}
						}
						$('.invoice_verification_form').remove();
						$('.invoice_verification_cancel_link').remove();
					})
					.catch(error => {
						this.feed('There has been a problem with your fetch operation. See console.', true);
						console.error(error);
					})
					.finally(() => {
						this.loadWalletSelector();
					});
				});


				// Get previous verified usernames and the the verification fee
				const server_url = this.getSetting('server_url');
				if(!server_url || typeof server_url != 'string' || !server_url.startsWith('http')){
					this.feed('No server URL set.', true);
					return;
				}
				const previousVerifiedNamesEndpoint = `${server_url}/verified_names_previous`;
				const formData = new FormData();
				formData.append('captcha_id', captchaId);
				formData.append('secret', this.getInvoiceSecret(captchaId));
				fetch(previousVerifiedNamesEndpoint, {
					method: 'POST',
					body: formData
				})
				.then(response => {
					if (response.ok) {
						return response.text();
					} else {
						throw new Error('Network response was not ok');
					}
				})
				.then(json => {
					const data = typeof json == 'string'? JSON.parse(json): json;
					if(!data || typeof data != 'object'){
						this.feed('Server response parse failed.', true);
						return;
					}
					const captcha_id = data?.captcha_id || null;
					const verified_names = data?.verified_names || [];
					if(captcha_id){
						const select = verificationForm.find(`select[name="previous_verified_usernames"][data-captcha-id="${captcha_id}"]`).first();
						if(select.length > 0){
							select.empty();
							if(verified_names.length > 0){
								verified_names.forEach((name) => {
									select.append(`<option value="${name}">${name}</option>`);
								});
								$('.previous_verified_usernames_container').slideDown(200, () => {
									select.on('change', (e) => {
										const targ = $(e.target);
										const captchaId = targ.attr('data-captcha-id');
										$(`input[name="username_submission"][data-captcha-id="${captchaId}"]`).val(e.target.value.replace(/\$/g,'').replace(/_/g,' '));
									});
								});
							}
						}
					}

					// Get the verification fee
					const server_url = this.getSetting('server_url');
					if(!server_url || typeof server_url != 'string' || !server_url.startsWith('http')){
						this.feed('No server URL set.', true);
						return;
					}
					const verificationFeeEndpoint = `${server_url}/static/current_fees.json`;
					fetch(verificationFeeEndpoint)
					.then(response => {
						if (response.ok) {
							return response.text();
						} else {
							throw new Error('Network response was not ok');
						}
					})
					.then(json => {
						const data = typeof json == 'string'? JSON.parse(json): json;
						var vfee = data?.verified_name || {};
							vfee = (vfee && typeof vfee == 'object')? vfee: {};
						const fee 	= vfee.fee || null;
						const unit 	= vfee.unit || null;
						var feeStr 	= 'Fee not found!';
						if(fee && unit){
							const ccode 	= this.getSelectedWalletCryptoCode();
							const stats 	= this.fiatToSatoshi(fee, ccode);
							const fiatStr 	= this.satoshiToFiatStr(stats, ccode);
							feeStr = `${fiatStr} (${stats} sats)`;
						}
						$('.user_verification_fee').empty().append(feeStr);
					});
				});
				targ.after(verificationForm);
				verificationForm.slideDown(200, () => {
					verificationForm.find('.verification_type').off().on('change', (e) => {
						const targ = $(e.currentTarget);
						const captchaId = targ.attr('data-captcha-id');
						const verificationType = targ.val();
						const feeDesc = verificationForm.find('.name_fee_desc[data-captcha-id="' + captchaId + '"]');
						if(verificationType == 'verified'){
							feeDesc.slideDown(200);
						}else{
							feeDesc.slideUp(200);
						}
					});
				});
			});
			var deposit_count = Array.isArray(invoice?.deposits)? invoice.deposits.length: 0;
				deposit_count++; // Add 1 for initial creation invoice.
			const depositsLink = $(`<a href="#" class="invoice_deposits_link" data-captcha-id="${name}" title="View deposits for this wallet">Deposits (${deposit_count})&nbsp;${this.heroicon('chevron-down')}</a>`);
			depositsLink.on('click', (e) => {
				e.preventDefault();
				const targ = $(e.currentTarget);
				const captchaId = targ.attr('data-captcha-id');
				const depositsDiv = $(`.invoice_deposits_drawer[data-captcha-id="${captchaId}"]`);
				if(depositsDiv.length > 0){
					if(depositsDiv.find('.deposit_container').length > 0){
						depositsDiv.slideUp(200, () => {
							depositsDiv.empty();
						});
					}else{
						const invoice 			= this.state.invoices?.[captchaId] || null;
						if(!invoice){
							this.feed('No invoice found for this captcha ID.', true, targ);
							return;
						}
						invoice.deposits 		= Array.isArray(invoice?.deposits)? invoice.deposits: [];

						// Special case for initial deposit
						const sats_paid 		= !isNaN(invoice?.satoshi*1)? invoice?.satoshi*1: 0; // any atomic unit, could be piconero or other
						const fiat_paid			= this.satoshiToFiatStr(sats_paid, invoice?.crypto_currency);
						const crypto_paid		= this.satoshiToCryptoStr(sats_paid, invoice?.crypto_currency);
						const inv_link     		= invoice.link? `<a href="${invoice.link}" target="_blank" class="pull-right">${this.heroicon('clipboard-document')}&nbsp;Link</a>`: '<span title="ERROR: Link not found" class="error">ERR</span>';
						const created			= invoice?.created || '';
						const deposit_container = $(
							`<div class="deposit_container" data-captcha-id="${captchaId}" style="font-size:1.4em;">
								<strong>Initial Deposit</strong><br>
								<span>${fiat_paid}&nbsp;${this.heroicon('information-circle')}</span>${inv_link}<br>
								<span style="font-size:0.8em;">${crypto_paid}</span><br>
								<span style="font-size:0.8em;" class="faded">Created: ${created}</span>
							</div>`
						);
						depositsDiv.append(deposit_container);
						
						// loop through deposits if any.
						for(var i=0; i<invoice.deposits.length; i++){
							const deposit 		= invoice.deposits[i];
							const deposit_cap 	= deposit?.captcha_id || null;
							const sats_paid 	= !isNaN(deposit?.satoshi*1)? deposit?.satoshi*1: 0; // any atomic unit, could be piconero or other
							const fiat_paid		= this.satoshiToFiatStr(sats_paid, invoice?.crypto_currency);
							const crypto_paid	= this.satoshiToCryptoStr(sats_paid, invoice?.crypto_currency);
							const inv_link    	= deposit.link? `<a href="${deposit.link}" target="_blank" class="pull-right">${this.heroicon('clipboard-document')}&nbsp;Link</a>`: '<span title="ERROR: Link not found" class="error">ERR</span>';
							const created		= deposit?.created || '';
							const deposit_container = $(
								`<div class="deposit_container" data-captcha-id="${deposit_cap}" style="font-size:1.4em;">
									<strong>Deposit #${i+1}</strong><br>
									<span>${fiat_paid}&nbsp;${this.heroicon('information-circle')}</span>${inv_link}<br>
									<span style="font-size:0.8em;">${crypto_paid}</span><br>
									<span style="font-size:0.8em;" class="faded">Created: ${created}</span>
								</div>`
							);
							depositsDiv.append(deposit_container);
						}
						const depositForm = $(`
							<form class="deposit_form" data-captcha-id="${captchaId}" style="display:none;">
							</form>	
						`);
						depositsDiv.append(`<h2>Deposit ${(invoice?.crypto_currency || 'more')}</h2>`);
						depositsDiv.slideDown(200);
					}
				}
			});
			const depositsDiv = $(`<div class="invoice_deposits_drawer" data-captcha-id="${name}" style="display:none;"></div>`);
			if(invoice.balance) invoiceDiv.find('.invoice_server_link').after(payoutForm).after(payoutLink);
			invoiceDiv.find('.alias_strong').after(verifyLink);
			invoiceDiv.find('.update_bal_container').empty().append(redeemLink);
			invoiceDiv.append(depositsLink, repoElement, depositsDiv);
            invoiceDivs.push(invoiceDiv);
		}

		// Tell users how many invoices they have
        const svr_url = this.getSetting('server_url');
        const ttl_str = total_invoices > server_invoices? `Total Wallets: ${total_invoices}<br>`: '';
		$('#gui').append(`${ttl_str}<a href="${svr_url}">${svr_url.replace('https://','')}</a> wallets: ${server_invoices}`,'<br>','<div id="wallet_check_options" style="display:none;"></div>');

        // Append the invoice divs to #form_container
        invoiceDivs.forEach(div => {
            $('#gui').append(div);
        });

		$('.wallet_checkbox').off().on('change', (e) => {
			$('.invoice').css({opacity: 1}).find('input[type="checkbox"]').prop('disabled', false);
			const check_count = $('.wallet_checkbox:checked').length;
			if(check_count == 1){
				$('.dust_verb').empty();
				const captcha_id = $('.wallet_checkbox:checked').attr('data-captcha-id');
				const dust_btn = $(`<button class="wallet_dust_btn wallet_opt_btn" data-captcha_id="${captcha_id}">Transfer Balance</button>`); // captcha_id is out address
				dust_btn.on('click', (e) => {
					e.preventDefault();
					const captcha_id 	= $(e.currentTarget).attr('data-captcha_id');
					const invoice 		= this.state.invoices[captcha_id];
					const ccode 		= invoice?.crypto_currency || null;
					const balance		= invoice?.balance || 0;
					if(!balance || balance < 1){
						this.feed('No balance found for this wallet.', true, $(e.currentTarget));
						return;
					}
					if(!ccode){
						this.feed('No crypto currency found for this wallet.', true, $(e.currentTarget));
						return;
					}
					$(`.dust_verb[data-captcha_id="${captcha_id}"]`).empty().append(`&nbsp;From&nbsp;`);
					$('.invoice').not(`.invoice[data-ccode="${ccode}"]`).css({opacity: 0.4}).find('input[type="checkbox"]').prop('disabled', true);
					$('#wallet_check_options').empty().append(`<span class="select_second_wallet_msg" data-captcha-id="${captcha_id}">Select the destination wallet.</span>`);
				});
				const delete_btn = $(`<button class="wallet_delete_btn wallet_opt_btn" data-captcha-id="${captcha_id}">Delete</button>`);
				delete_btn.on('click', (e) => {
					e.preventDefault();
					const captcha_id 	= $(e.currentTarget).attr('data-captcha-id');
					const confirm_btn 	= $(`<button class="wallet_delete_btn wallet_opt_btn" data-captcha_id="${captcha_id}">Confirm Delete</button>`);
					const confirm_txt	= $(`<input type="text" class="wallet_delete_confirm" placeholder="Type 'delete' to confirm." style="width:100%;margin-top:10px;">`);
					const cancel_btn	= $(`<button class="wallet_delete_cancel wallet_opt_btn">Cancel</button>`);
					confirm_btn.on('click', (e) => {
						e.preventDefault();
						const confirm_txt = $('.wallet_delete_confirm').first().val();
						// Make sure user typed 'delete' to confirm or 
						if(confirm_txt != 'delete'){
							this.feed('Please type "delete" to confirm.', true, $('.wallet_delete_confirm'));
							return;
						}
						const captcha_id = $(e.currentTarget).attr('data-captcha_id');
						delete this.state.invoices[captcha_id];
						this.saveState();
						this.buildWalletForm();
					});
					cancel_btn.on('click', (e) => {
						// uncheck all invoice checkboxes and trigger change event
						$('.wallet_checkbox').prop('checked', false).trigger('change');
					});
					setTimeout(function(){ // focus
						$('.wallet_delete_confirm').focus();
					},50);
					confirm_txt.on('keyup', (e) => {
						e.preventDefault();
						// Alt+Enter (admin shortcut)
						if(e.key === 'Enter' && e.altKey){
							$('.wallet_delete_confirm').val('delete');
							$('.wallet_delete_btn').first().trigger('click');
						}
					});
					$('#wallet_check_options').empty().append('Are you sure you want to delete this wallet?<br><br><strong class="error">This action cannot be undone!!!</strong><br><br>',confirm_txt,'<br><br>',confirm_btn,cancel_btn);
				});
				$('#wallet_check_options').empty().append(dust_btn,delete_btn).slideDown(200);
			}else if(check_count > 1){
				if(check_count == 2 && $('.select_second_wallet_msg').length > 0){
					const captcha_id	= $('.select_second_wallet_msg').attr('data-captcha-id');
					const dest_captcha 	= $('.wallet_checkbox:checked').not(`[data-captcha-id="${captcha_id}"]`).first().attr('data-captcha-id');
					const in_invoice 	= this.state.invoices[dest_captcha] || null;
					const out_invoice	= this.state.invoices[captcha_id] || null;
					if(!in_invoice || !out_invoice){
						this.feed('Wallet Error.', true, $(e.currentTarget));
						return;
					}
					const in_alias 		= in_invoice?.alias || dest_captcha.substr(0, 8);
					const out_alias 	= this.state.invoices[captcha_id]?.alias || captcha_id.substr(0, 8);
					const out_balance 	= out_invoice?.balance || 0;
					const out_ccode 	= out_invoice?.crypto_currency || null;
					const out_fiat_bal	= this.satoshiToFiatStr(out_balance, out_ccode);
					const cancel_icon	= this.heroicon('x-mark') || '❌';
					const cancel_btn	= $(`<button class="wallet_delete_cancel wallet_opt_btn pull-right">${cancel_icon}&nbsp;Cancel</button>`);
					const confirm_btn 	= $(`<button class="wallet_dust_btn wallet_opt_btn" data-out-captcha="${captcha_id}" data-in-captcha="${dest_captcha}">Complete Transfer</button>`);
					cancel_btn.on('click', (e) => {
						e.preventDefault();
						this.buildWalletForm(); // Need to account for the fact that checkboxes have been removed.
					});
					confirm_btn.on('click', (e) => {
						e.preventDefault();
						const in_captcha 	= $(e.currentTarget).attr('data-in-captcha');
						const out_captcha 	= $(e.currentTarget).attr('data-out-captcha');
						this.dustInvoice(out_captcha, in_captcha);
					});
					$('#wallet_check_options').empty().append(`Transfer ${out_fiat_bal} from ${out_alias} to ${in_alias}?<br><br>`,confirm_btn,cancel_btn);
					$(`.dust_verb[data-captcha_id="${dest_captcha}"]`).empty().append(`&nbsp;To&nbsp;`);
					return;
				}
				$('.dust_verb').empty();
				const group_btn = $(`<button class="wallet_group_btn wallet_opt_btn">Group ${check_count} Wallets</button>`);
				group_btn.on('click', (e) => {
					e.preventDefault();
					try{
						var captcha_ids = [], secrets = [];
						$('.wallet_checkbox:checked').each(function(){
							const cap = $(this).attr('data-captcha-id');
							captcha_ids.push(cap);
							secrets.push(app.getInvoiceSecret(cap));
						});
						this.groupCaptchasTmp 	= captcha_ids;
						const server_url 		= app.getSetting('server_url');
						const group_endpoint	= `${server_url}/group_invoices`;
						const formData = new FormData();
						const joined_ids = captcha_ids.join(',');
						const joined_secrets = secrets.join(',');
						formData.append('captcha_ids', joined_ids);
						formData.append('secrets', joined_secrets);
						fetch(group_endpoint, {
							method: 'POST',
							body: formData
						})
						.then(response => {
							if (response.ok) {
								return response.text();
							} else {
								throw new Error('Network response was not ok');
							}
						})
						.then(json => {
							const data = typeof json == 'string'? JSON.parse(json): json;
							if(!data || typeof data != 'object'){
								app.feed('Server response parse failed.', true);
								return;
							}
							if(data.error){
								app.feed(data.error, true);
							}else if(data.msg){
								app.feed(data.msg);
								if(data?.group_id && this.groupCaptchasTmp.length > 0){
									for(var i=0; i<this.groupCaptchasTmp.length; i++){
										const cap = this.groupCaptchasTmp[i];
										const inv = app.state.invoices[cap];
										if(inv) inv.invoice_group = data.group_id*1;
									}
									this.saveState();
									this.groupCaptchasTmp = [];
								}
							}
						})
						.catch(error => {
							app.feed('There has been a problem with your fetch operation. See console.', true);
							console.error(error);
						})
						.finally(() => {
							app.buildWalletForm();
						});
					}catch(e){
						console.error(e);
					}
				});
				$('#wallet_check_options').empty().append(group_btn).slideDown(200);
			}else{
				$('.dust_verb').empty();
				$('#wallet_check_options').slideUp(200,function(){
					$(this).empty();
				});
			}
		});

		// Refresh all balances button
		const refreshAllBtn = $(`<button class="wallet_refresh_all_btn">Refresh All Wallet Balances</button>`);
		refreshAllBtn.on('click', (e) => {
			e.preventDefault();
			$('.invoice_redeem_link').addClass('redeem_queue');
			$('.invoice_redeem_link').prop('disabled', true).find('.verb_span').empty().append('Queued...');
			this.redeemAll();
		});
		$('#gui').append('<br><br>',refreshAllBtn);

        // Invoice recovery form
        const recoveryForm = $(
            '<form class="invoice_recovery_form">' + 
                '<textarea name="mnemonic_phrase" class="mnemonic_phrase" placeholder="Recovery Phrase..."></textarea>' + 
                '<input type="submit" value="Recover Wallet">' + 
            '</form>'
        );
        recoveryForm.on('submit', (e) => {
            e.preventDefault();
            this.recoverInvoice(e.currentTarget);
        });
        $('#gui').append('<br><br><hr><h2>Recover a Wallet',recoveryForm);
		$('#ext_search').attr('placeholder','Search Wallets...');
	}

	dustInvoice(out_captcha, in_captcha){
		$('#wallet_check_options').empty().append('<br><br>Please wait...');
		const server_url = this.getSetting('server_url');
		if(!server_url || typeof server_url != 'string' || !server_url.startsWith('http')){
			this.feed('No server URL set.', true);
			return;
		}
		try{
			const in_secret 	= this.state.invoices?.[in_captcha]?.secret || null;
			const out_secret 	= this.state.invoices?.[out_captcha]?.secret || null;
			if(!in_secret || !out_secret){
				this.feed('Wallet Error.', true);
				return;
			}
			const dustEndpoint 	= `${server_url}/dust_invoice`;
			const formData 		= new FormData();
			formData.append('in_captcha', in_captcha);
			formData.append('out_captcha', out_captcha);
			formData.append('in_secret', in_secret);
			formData.append('out_secret', out_secret);
			fetch(dustEndpoint, {
				method: 'POST',
				body: formData
			})
			.then(response => {
				if (response.ok) {
					return response.text();
				} else {
					throw new Error('Network response was not ok');
				}
			})
			.then(json => {
				const data = typeof json == 'string'? JSON.parse(json): json;
				if(!data || typeof data != 'object'){
					this.feed('Server response parse failed.', true);
					return;
				}
				if(data.error){
					this.feed(data.error, true);
				}else if(data.msg){
					this.feed(data.msg);
					const in_captcha 	= data?.in_captcha 	|| null;
					const out_captcha 	= data?.out_captcha || null;
					const in_balance 	= data?.in_balance 	|| null;
					const out_balance 	= data?.out_balance || null;
					if(in_captcha && out_captcha && !isNaN(in_balance*1) && !isNaN(out_balance*1)){
						this.state.invoices[in_captcha].balance 	= in_balance*1;
						this.state.invoices[out_captcha].balance 	= out_balance*1;
						this.skipFeed = true;
						this.buildWalletForm();
					}
				}
			})
			.catch(error => {
				this.feed('There has been a problem with your fetch operation. See console.', true);
				console.error(error);
			});
		}catch(e){
			this.feed('Transfer Error.', true);
			console.error(e);
		}
	}

	redeemInvoice(captchaId){
		if(this.paused) return;
		this.transactionCaptcha = null; // this should be set to null after the transaction is complete and the balance is updated with this method.
		const server_url = this.getSetting('server_url');
		if(!server_url || typeof server_url != 'string' || !server_url.startsWith('http')){
			this.feed('No server URL set.', true, $(`.invoice[data-captcha-id="${captchaId}"]`));
			return;
		}
		const redeemEndpoint = `${server_url}/redeem_invoice`;
		const formData = new FormData();
		formData.append('captcha_id', captchaId);
		formData.append('secret', this.state.invoices[captchaId].secret);

		// Send the POST request to redeem the invoice
		fetch(redeemEndpoint, {
			method: 'POST',
			body: formData
		})
		.then(response => {
			
			if (response.ok) {
				return response.text();
			} else {
				throw new Error('Network response was not ok');
			}
		})
		.then(json => {
			
			const data = typeof json == 'string'? JSON.parse(json): json;
			if(!data || typeof data != 'object'){
				this.feed('Server response parse failed.', true, $(`.invoice[data-captcha-id="${captchaId}"]`));
				return;
			}
			if(data.error){
				this.feed(data.error, true, $(`.invoice[data-captcha-id="${captchaId}"]`));
			}else if(data.msg){
				this.feed(data.msg, false, $(`.invoice[data-captcha-id="${captchaId}"]`));
				Object.assign(this.state.invoices[captchaId], { // preserves the recovery phrase.
					alias: 			data?.alias || null,
					rows_remaining: data?.rows_remaining || 0,
					satoshi_paid: 	data?.satoshi_paid || 0,
					btc_paid: 		data?.btc_paid || 0,
					balance: 		data?.balance || 0,
					rate_quote: 	data?.rate_quote || 0,
					link: 			data?.link || null,
					exchange_rate: 	data?.exchange_rate || "...",
					currency_pair: 	data?.currency_pair || "...",
					server_url: 	(this?.state.settings?.server_url || null).toString(),
					conv_balance:	((data?.exchange_rate || 0) * ((data?.balance || 0) / 100000000)) || 0,
					crypto_currency:data?.crypto_currency || '???',
					invoice_group: 	data?.invoice_group || null,
				});
				this.saveState();
				this.redeemAll(); // only runs if there are any queued invoices to redeem.
			}
		})
		.catch(error => {
			this.feed('Failed to redeem invoice.', true, $(`.invoice[data-captcha-id="${captchaId}"]`));
			console.error(error);
            this.buildWalletForm();
		})
		.finally(() => {
			// If we are not in the queue, rebuild the form.
			this.loadWalletSelector();
		});
	}

	redeemAll(){
		const queuedRefreshLinks = $('.invoice_redeem_link.redeem_queue');
		if(queuedRefreshLinks.length > 0){
			const firstLink = queuedRefreshLinks.first();
			firstLink.prop('disabled',false).removeClass('redeem_queue').addClass('batters_box');
			setTimeout(function(){
				$('.batters_box').trigger('click');
				$('.batters_box').removeClass('batters_box');
			},10000);
			return true;
		}
		return false;
	}

	heroicon(name) {
		const svgContainer = $('#heroicon-' + name);
		if (svgContainer.length > 0) {
			const svg = svgContainer.find('svg');
			if (svg) return svg.prop('outerHTML');
		}
		return false;
	}

	scrollDown() {
		this.newMessages = 0;
		this.skipAutoScroll = false;
		$('#scroll_to_bottom_container').slideUp(200);
		setTimeout(() => {
			$('#gui').animate({ scrollTop: $('#gui').prop('scrollHeight') }, 400);
		}, 10);
	}
}
