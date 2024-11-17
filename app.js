/* App State */
class AppState {
	constructor() {
		this.version			= '0.0.3';
		this.paused 			= false;
		this.state				= {};
		this.settingsSchema 	= {};
		this.passCache			= {}; // Password attempts by thread id
		this.contentCacheFC		= null; // Used to save the last chat sent for when users are doing a free chat.
		this.replyToCacheFC		= null; // Used to save the last chat sent for when users are doing a free chat.
		this.threadIdCacheFC	= null; // Used to save the last chat sent for when users are doing a free chat.
		this.newPassCacheFC		= null; // Used to save the last chat sent for when users are doing a free chat.
		this.settingsDefault 	= {
		    server_url:            			"https://catsupnorth.com", // fallback server url
			refresh_threads_microseconds:	60_000, // 1 minute
			refresh_chat_microseconds:		1000, // 0.5 seconds
			url_preview_max_len: 			40,
			min_spend_threshold: 			1,
			fiat_code: 						'USD',
			ignore_free_threads: 			false,
			ignore_free_chats: 				false,
		};
        this.settingsSchema 	= {
            server_url:            			'string',
            refresh_threads_microseconds:	'number',
            refresh_chat_microseconds:		'number',
            url_preview_max_len: 			'number',
            min_spend_threshold: 			'number',
            fiat_code: 						'string',
            ignore_free_threads: 			'boolean',
            ignore_free_chats: 				'boolean',
        };
		this.settingsLimits 	= {
			refresh_threads_microseconds: 	[2500, 60000], // 2.5 seconds to 60 seconds
			refresh_chat_microseconds: 		[550, 5000],  // 0.55 seconds to 5 seconds
		};
		this.skipFeed 			= false; // skip feed message if true only once (set back to false just before feed method exits early)
		this.skipAutoScroll 	= false; // skip autoscroll if user is scrolling up in the chat.
		this.currentCaptcha 	= null;
		this.transactionCaptcha	= null; // set to captchaId when user initiates a super chat or a verified username purchase.
		this.followSearch		= null;
		this.newMessages 		= 0;
		this.conversionRates 	= [];
		this.midRequest 		= false;
		this.lastThreadLoaded 	= null;
		this.allThreadChatIds 	= [];
		this.currentMetadata 	= {};
		for (let key in this.settingsDefault) this.settingsSchema[key] = typeof this.settingsDefault[key];
		this.settingsSchema.server_url = 'string';
		this.loadState();
	}
	
	feed(arg, err = false, cloneBefore = null){
		if(this.skipFeed && !err){ // used when autoloading threads or chats right after user action
			this.skipFeed = false;
			return;
		}
		$('.feed_clone').remove();
		if(err) console.trace(arg);	// for debugging
		$('#feed_error').toggle((err? true: false));
		$('#feed').empty().append((arg.toString() || "&nbsp;"));
		// Check if cloneBefore is a jquery object with length > 0 and then add a clone of #feed before it (remove id first).
		if(cloneBefore && cloneBefore.length > 0){
			const feed_clone = $('#feed').clone().removeAttr('id').addClass('feed_clone');
			feed_clone.append('<br>').css({display:'none', width:'100%', minWidth: '100%'});
			feed_clone.insertBefore(cloneBefore);
			feed_clone.slideDown(200,()=>{
				setTimeout(() => { $('.feed_clone').slideUp(200); }, 5000); // The next feed message will remove this junk clone
			});
		}
	}

	clearNewMessages(){
		this.newMessages = 0;
		$('.new_msg_indicator').empty();
	}

	_decodeHTMLEntities(text) {
		let e = $(`<div>${text.toString()}</div>`);
		return e.text();
	}

	pause() {
		this.paused = this.paused? false: true;
		const pause_link = document.getElementById('pause');
		if (pause_link) pause_link.style.opacity = this.paused? '1': '0.5';
	}

	// Load the state from chrome.storage.local
	loadState() {
		chrome.storage.local.get(['invoices', 'current_user_url', 'settings'], (result) => {
			if (chrome.runtime.lastError) {
				console.error('Error loading state:', chrome.runtime.lastError);
				return;
			}
			this.state.invoices 		= result.invoices 			|| {};
			this.state.current_user_url = result.current_user_url 	|| '';
			this.state.settings 		= result.settings 			|| {};

			if (Object.keys(this.state.settings).length < Object.keys(this.settingsDefault).length) {
				this.state.settings = JSON.parse(JSON.stringify(this.settingsDefault));
			}

			if(!this.currentCaptcha) this.currentCaptcha = Object.keys(this.state.invoices)[0] || null;

			this.updateConversionRates();

			// background.js will have already sent the current user URL, so we need to update the state manually on startup.
			try{
				chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
					if (tabs.length > 0){
						this.getThreads(tabs[0].url);
					}
				});
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

		chrome.storage.local.set(this.state, () => {
			if (chrome.runtime.lastError) {
				console.error('Error saving state:', chrome.runtime.lastError);
			}
		});

		const server_url = this.getSetting('server_url');
		if(!server_url || typeof server_url != 'string' || server_url.length < 1) return;
		document.getElementById('server_link').href 		= server_url + '';
		document.getElementById('server_link').textContent 	= server_url.replace(/https?:\/\//, '');
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
	
	createWallet(val, curr) {
		const server_url = this.getSetting('server_url');
		if (!server_url || typeof server_url != 'string' || server_url.length < 1) {
			this.feed('Server URL not set.', true);
			return;
		}
		const buyEndpoint 	= `${server_url}/buy?val=${encodeURIComponent(val)}&cur=${encodeURIComponent(curr)}`;
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

		document.querySelectorAll('.superchat_input').forEach(   (input) => { input.value = ''; } );
		document.querySelectorAll('.superchat_satoshi').forEach( (input) => { input.value = 0;  } );
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
			formData.append('secret', this.state.invoices[captcha_id].secret);
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
				console.log('PUSHING',prop,this.state.currentMetadata[prop]);
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
					document.querySelectorAll('.free_chat_captcha_form').forEach((form) => { form.remove(); });
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
				$('#captcha_form_container').empty().append(captchaForm).slideDown(200);
				captchaForm.find('.free_chat_human_guess').focus();
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
		try{
			const invoice = this.state.invoices?.[this.currentCaptcha];
			const follows = invoice?.follows || [];
			return follows.indexOf(alias) > -1;
		}catch(e){
			console.error(e);
		}
		return false;
	}
	
	updateFollowList(captchaId = null, build_follow_list = false){
		if(this.paused) return;
		this.followSearch = captchaId;
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
			const invoice = this.followSearch in this.state.invoices? this.state.invoices[this.followSearch]: null;
			if(invoice) invoice.follows = data?.follows || [];
			this.saveState();
			$('.follow_link').each((i, el) => {
				const alias = $(el).data('alias');
				const iFollow = invoice.follows.indexOf(alias) > -1;
				$(el)
					.empty()
					.append(iFollow? this.heroicon('minus').outerHTML: this.heroicon('plus').outerHTML, `&nbsp;${alias}`)
					.attr('title', (iFollow? 'Unfollow': 'Follow'))
					.data('unfollow', (iFollow? 'yes': 'no'))
					.removeClass('following');
				if(iFollow) $(el).addClass('following');
			});
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
		for(let captchaId in this.state.invoices){
			const invoice = this.state.invoices[captchaId];
			var captchaName = captchaId.substring(0, 8) + '...';
			if('alias' in invoice && invoice.alias && typeof invoice.alias == 'string' && invoice.alias.length > 0) captchaName = invoice.alias;
			const userFollows = invoice?.follows || [];
			const followCount = userFollows.length;
			$('#form_container').append(`<h4>${captchaName} follows ${followCount} user${( followCount == 1? '': 's' )}</h4>`);
			if(followCount < 1) continue
			const followList = $('<ul class="follow_ul"></ul>');
			for(var i=0; i<followCount; i++){
				const u = userFollows[i];
				const unfollow_link = $(`<a href="#" class="unfollow_link error" data-alias="${u}" title="Unfollow this user">${this.heroicon('user-minus').outerHTML} Unfollow</a>`);
				unfollow_link.on('click', (event) => {
					const targ = $(event.currentTarget);
					targ.animate({opacity: 0}, 200).animate({opacity: 1}, 200);
					this.followUser(targ.data('alias'), 'yes', true);
				});
				const user_page_link = $(`<a class="follow_item" href="${serverURL}/u/${u}" title="Visit this user's page." target="_blank">${u}&nbsp;&nbsp;</a>`);
				const li = $('<li></li>');
				li.append(user_page_link).append(unfollow_link);
				followList.append(li);
			}
			$('#form_container').append(followList);
		}
	}

	followUser(alias, unfollow_str = 'no', build_follow_list = false){
		const formData 	= new FormData();
		formData.append('verified_username_follow',	alias);
		formData.append('unfollow', unfollow_str);
		formData.append('captcha_id', this.currentCaptcha);
		formData.append('secret', this.getInvoiceSecret(this.currentCaptcha));
		const server_url = this.getSetting('server_url');
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
				this.updateFollowList(this.currentCaptcha, build_follow_list); // Fetches my follows from the server and saves state.
			}
		})
		.catch(error => {
			this.feed('Follow operation failed on server end.', true);
			console.error(error);
		});
	}
	
	reactDiv(chat_id, timestamp = null){ // reply_count is only used by threads.
		const container = $('<span class="reaction_container"></span>');
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
		container.append(`<span class="time_info">&nbsp;${date_str}</span>&nbsp;`);
		container.append(
			`<span class="reaction_link_span pull-right">
				<a href="#" class="reaction_button like_button" data-chat-id="${chat_id}" style="padding-right:3px;padding-left:3px;">
					${this.heroicon('chevron-up').outerHTML}
					<span class="reaction_count like_count" data-chat-id="${chat_id}">0</span>
				</a>
				<a href="#" class="reaction_button dislike_button" data-chat-id="${chat_id}" style="padding-left:3px;">
					${this.heroicon('chevron-down').outerHTML}
					<span class="reaction_count dislike_count" data-chat-id="${chat_id}">0</span>
				</a>
			</span>`
		);
		container.prepend('<br>');

		// Cross-posting and replies
		var crossPostLink = $(`<a href="#" class="cross_post_link" data-chat-id="${chat_id}" title="Cross-Post chat to another thread."></a>`);
		crossPostLink.append(this.heroicon('arrows-right-left').outerHTML || '⇄');
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
			const cancelIcon = this.heroicon('x-mark').outerHTML || '❌';
			const cancelLink = $(`<a href="#" class="cancel_cross_post pull-right faded" title="Cancel Cross-Post">${cancelIcon}&nbsp;Cancel Cross-Post</a>`);
			cancelLink.on('click', (event) => {
				event.preventDefault();
				this.clearChatCloneContainer(true);
			});
			$('#reply_clone_container').css({display:'none'}).empty().append(`<hr><span class="xpost_info">${title}`,crossPostClone,'</span><br>&nbsp;',cancelLink).slideDown(300);
		});
		var replyLink = $(`<a href="#" class="reply_link chat_reply_link" data-chat-id="${chat_id}" title="Reply to chat."></a>`);
		replyLink.append(
			(this.heroicon('chat-bubble-bottom-center').outerHTML || '💬'),
			`<span class="chat_reply_count" data-chat-id="${chat_id}" style="padding-left:4px;"></span>`
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
			const cancelIcon = this.heroicon('x-mark').outerHTML || '❌';
			const cancelLink = $(`<a href="#" class="cancel_reply_to pull-right faded" title="Cancel Reply">${cancelIcon}&nbsp;Cancel Reply</a>`);
			cancelLink.on('click', (event) => {
				event.preventDefault();
				this.clearChatCloneContainer();
			});
			$('#reply_clone_container').css({display:'none'}).empty().append(`<hr><span class="chat_info">${title}</span>`,replyToClone,'<br>&nbsp;',cancelLink).slideDown(300);
		});
		container.find('.reaction_link_span').prepend(crossPostLink).prepend(replyLink);
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
			const followIcon	= iFollow? this.heroicon('minus').outerHTML: this.heroicon('plus').outerHTML;
			const unfollowStr	= iFollow? 'yes': 'no';
			const verb			= iFollow? 'Unfollow': 'Follow';
			link				= $(`<a href="#" title="${verb}" class="follow_link${( iFollow? ' following' : '' )}" data-alias="${alias_str}" data-unfollow="${unfollowStr}">${followIcon}&nbsp;${alias_str}</a>`);
			link.click((event) => {
				event.preventDefault();
				if(this.paused) return;
				const targ = $(event.currentTarget);
				targ.animate({opacity: 0}, 200).animate({opacity: 0.7}, 200);
				this.followUser(targ.data('alias'), targ.data('unfollow'));
			});
		}
		return link;
	}

	createUserPageLink(alias){
		var link = '';
		if(alias && typeof alias == 'string' && alias.startsWith('$')){
			const server_url 	= this.getSetting('server_url');
			const icon			= this.heroicon('arrow-top-right-on-square').outerHTML || '⎘';
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

	updateReactions(reactions){
		if(!reactions || !Array.isArray(reactions)) return;
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

		// Add event listeners to reaction buttons

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
					}
				})
				.catch(error => {
					this.feed('There has been a problem with your fetch operation. See console.', true);
					console.error(error);
				});
			});
		}
	}
	
	clearSearch(){
		$('#ext_search').val('').trigger('keyup');
	}

    setCurrentThreadID(threadId = null){
		this.clearSearch();
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

	loadThread(threadId = null, password = null){
		if(!threadId || isNaN(threadId*1)) threadId = this.getCurrentThreadID();

		if(this.paused || !threadId) return;
		this.midRequest = true;
        this.setCurrentThreadID(threadId);
		$('.thread').remove(); // hide all threads
		$('#create_thread_options').css({display: 'none'});
		const lastChat 	= $('.chat').not('.cross_post').last();
		const startMode = lastChat.length > 0? false: true;
		if(startMode && threadId != this.lastThreadLoaded){
			$('#chat_input').focus();
			this.loadingMsg(`Loading Thread ${threadId}`);
			this.allThreadChatIds = [];
		}
		this.lastThreadLoaded = threadId;
		const formData 	= new FormData();
		formData.append('thread_id', threadId);
		if (!password) password = this.getCachedPass(threadId);
		if (password) formData.append('password', password);
		const server_url = this.getSetting('server_url');
		if (!server_url) {
			this.feed('Server URL not set.', true);
			return;
		}
		const threadEndpoint = `${server_url}/get_thread_chats`;
		if(!startMode && lastChat && lastChat.length > 0){
			formData.append('date_submitted_after',lastChat.attr('data-date-submitted'));
		}
		if(this.currentCaptcha){
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
			if(startMode){
				$('#gui').empty();	
				this.loadWalletSelector();
			}
			const data = typeof json == 'string'? JSON.parse(json): json;
			if(!data || typeof data != 'object' || !('chats' in data)){
				this.feed('Server response parse failed.', true);
				return;
			}
			if (data.error) {
				this.feed(data.error, true);
				return;
			}
			if(startMode) this.feed(data?.msg || 'Thread loaded.');
			const threadChats = data.chats;

			this.addThreadChatIds(threadChats); // Needed to see if X-Posts should be added directly to the thread.
			
			// Sort the chats by date_submitted
			threadChats.sort((a,b) => {
				if(a.date_submitted < b.date_submitted) return -1;
				if(a.date_submitted > b.date_submitted) return 1;
				return 0;
			});

			threadChats.forEach( chat => {
				const isMe 		= chat?.is_me || false;
				const isFree 	= chat?.is_free || false;
				const isTop 	= (!chat.reply_to_id && chat.thread_id == threadId)? true: false;
				const isSuper	= (chat.superchat && !isNaN(chat.superchat*1) && chat.superchat > 0)? true: false;

				// Do not add chats that are already in the thread
				if($(`.chat[data-id="${chat.chat_id}"]`).length > 0) return; // chat already rendered, skip

				// Do not re-render top chat ever (it should always load)
				if(isTop && !startMode) return;

				if(!startMode && this.skipAutoScroll && !isTop) this.newMessages++;

				var chatDivClasses 	= [],
					superChatStr	= '',
					chatStr			= this._decodeHTMLEntities(chat.chat_content.toString());
				if(isFree) 	chatDivClasses.push('free_chat');
				if(isMe) 	chatDivClasses.push('my_chat');
				if(isTop){
					chatDivClasses.push('original_chat');
				}else{
					chatDivClasses.push('chat');
					chatDivClasses.push('hidden_chat');
				}
				if(isSuper){
					chatDivClasses.push('superchat');
					const fiatStr 	= this.satoshiToFiatStr(chat.superchat);
					const cryptoStr = this.satoshiToCryptoStr(chat.superchat);
					const star 		= this.heroicon('star-solid').outerHTML || '⭐';
					superChatStr 	= `<div class="superchat_amount">${star}&nbsp;&nbsp;${fiatStr}&nbsp;&nbsp;${star}&nbsp;&nbsp;${cryptoStr}&nbsp;&nbsp;${star}</div>`;
				}
				chatDivClasses = chatDivClasses.join(' ');
				const chatDiv = $(
					`<div class="${chatDivClasses}" data-id="${chat.chat_id}" data-reply-to-id="${chat.reply_to_id}" data-date-submitted="${chat.date_submitted}" style="display:${(isTop? 'block': 'hidden')};">
					 	${superChatStr}
					</div>`
				);
				chatDiv.append(this.createFollowLink(chat.alias,isMe,isFree),'&nbsp;&nbsp;',this.createUserPageLink(chat.alias),'&nbsp;&nbsp;',chatStr);
				chatDiv.append(this.reactDiv(chat.chat_id,chat.date_submitted));
				// check if cross post
				if(chat.thread_id != threadId){
					const shortURL 		= chat.url.length < 30? chat.url: chat.url.substring(0,30) + '...';
					chatDiv.addClass('cross_post').removeClass('my_chat').removeClass('superchat').prepend(
						`<br>
						 <a href="${chat.url}" title="${chat.url}" class="cross_post_ext_link">${shortURL}</a>
						 <br>
						 <span class="xpost_info">X-Post from thread ${chat.thread_id}</span>
						 <br>`
					);
				}
				if(chat.reply_to_id == 0 && chat.thread_id == threadId){
					chatDiv.find('.reply_link').remove();
					$('#main_thread_chat').empty().append(chatDiv);
				}else{
					chatDiv.append(`<div class="reply_container" data-chat-id="${chat.chat_id}"></div>`); // MY reply container
					const replyContainer = $(`.reply_container[data-chat-id="${chat.reply_to_id}"]`); // THEIR reply container
					if(replyContainer.length > 0){
						chatDiv.css({paddingRight:'0'});
						replyContainer.append(chatDiv);
					}else{
						$('#gui').append(chatDiv);
					}
				}
			});

			// add reply count based on how many chats are in each reply_container
			$('.chat').each((i, el) => {
				const reply_container 	= $(el).find('.reply_container');
				const reply_count		= reply_container.children().length;
				$(el).find('.chat_reply_count').text(reply_count);
			});

			const newMsgPlur = this.newMessages == 1? '': 's';
			$('#new_msg_indicator').empty().append(this.newMessages > 0? `&nbsp;|&nbsp;${this.newMessages} New Message${newMsgPlur}`: '');
			this.updateReactions(data?.reactions);

			// scroll to btm of thread_container
			if(startMode){
				this.skipAutoScroll = false;
				$('#scroll_to_bottom_container').css({display:'block'});
			}
			if(!this.skipAutoScroll) this.scrollDown();
			this.cleanUpTimeInfo();

			$('#thread_id_indicator').empty().append(this.getCurrentThreadID());
			$('#exit_thread_container').css({display:'block'});
		})
		.catch(error => {
			this.feed('There has been a problem with your fetch operation. See console.', true);
			console.error(error);
		})
		.finally(() => {
			$('.hidden_chat').removeClass('hidden_chat').slideDown(300);
			// show user the change in balance
			if(this.transactionCaptcha){
				this.skipFeed = true;
				this.redeemInvoice(this.transactionCaptcha);
			}
			this.midRequest = false;
			const chatCount = $('.chat').length;
			$('#ext_search').attr('placeholder',`Search ${chatCount} Chat${( chatCount == 1? '': 's')}...`);
		});
	}

	getThreads(url_arg = null){
		if(this.paused) return;
		this.allThreadChatIds = [];
		this.midRequest = true;
		this.lastThreadLoaded = null;
		this.loadingMsg('Fetching Threads');
		this.setCurrentThreadID(null);
		this.clearChatCloneContainer();
		$('#scroll_to_bottom_container').add('#exit_thread_container').add('#create_thread_options').add('#spend_form').css('display','none');
		if(url_arg) this.updateCurrentUserURL(url_arg);
		const url = this.getCurrentURL();
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
				const threads = data.threads;
				if(!threads || !Array.isArray(threads) || threads.length < 1){
					$('#gui').append('<h2 style="opacity:0.7;"><br><br>Be the first to create a thread on this page!</h2>');
					return;
				}
				const server_url = this.getSetting('server_url');
				threads.forEach( thread => {
					const isMe = thread?.is_me || false;
					const isFree = thread?.is_free || false;

					const threadDiv = $('<div class="thread' + (isFree? ' free_thread': '') + '' + (isMe? ' my_thread': '') + '"></div>');
					threadDiv.append(this.createFollowLink(thread.alias, isMe, isFree),'&nbsp;&nbsp;',this.createUserPageLink(thread.alias));
					if(server_url && thread.alias && thread.alias.startsWith('$')){
						const channelURL  = (thread.channel && typeof thread.channel == 'string')? `${server_url}/u/${thread.alias}?channel=${thread.channel}`: '';
						const channelLink = thread.channel? `<span class="chat_info pull-right">in&nbsp;<a href="${channelURL}" target="_blank">${thread.channel}</a></span>`: '';
						threadDiv.append(channelLink);
					}
					threadDiv.append('<br>');
					
					const password_xml = thread.password_required? this.heroicon('lock-closed').outerHTML + '&nbsp;': '';
					// const loadThreadLink = $(
					// 	`<a class="thread_opener" data-thread-id="${thread.thread_id}">
					// 		<span style="font-size:9px;opacity:0.6;">
					// 			<strong style="color:grey;">Thread ${thread.thread_id}</strong><span class="pull-right">${password_xml}</span>
					// 		</span><br>
					// 		<span>${thread.chat_content}</span>
					// 	</a>`
					// );
					const loadThreadLink = $(
						`<a class="thread_opener" data-thread-id="${thread.thread_id}" data-chat-id="${thread.chat_id}">
							${password_xml}${thread.chat_content}
						</a>`
					);
					if(thread.password_required) loadThreadLink.addClass('password_required');
					loadThreadLink.on('click', (e) => {
						e.preventDefault();
						if(this.paused) return;
						// Get thread ID from the clicked element
						const ctarg 	= $(e.currentTarget);
						const threadId 	= ctarg.attr('data-thread-id');
						if(ctarg.hasClass('password_required')){
							const existingPassForm = document.querySelector('.thread_pass_form[data-thread-id="' + threadId + '"]');
							if(existingPassForm){ // user decides not to join thread
								// remove all existing pass forms
								const passForms = document.querySelectorAll('.thread_pass_form');
								passForms.forEach((passForm) => passForm.remove());
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
					threadDiv.append(loadThreadLink);
					threadDiv.append(this.reactDiv(thread.chat_id, thread.chat_date_submitted));
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

	getSetting(key) {
		return this.state.settings?.[key] || this.settingsDefault[key] || null;
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
		this.state.current_user_url = url.toString();
		$('#current_url').attr('title',this.getCurrentURL()).empty().append(this.getShortURL());
		if(save_state) this.saveState();
	}

	updateCurrentMetadata(metadata){
		console.log(metadata);
		this.state.currentMetadata = (metadata && typeof metadata == 'object')? JSON.parse(JSON.stringify(metadata)): {};
		console.log(this.state.currentMetadata);
		this.saveState();
	}

	updateConversionRates(){
		if(this.paused) return;
		
		const server_url = this.getSetting('server_url');
		if(!server_url || typeof server_url != 'string' || !server_url.startsWith('http')) return;
		const conversionRateURL = `${server_url}/static/btc_rate_current.json`

		// Get the refresh rate
		if(!conversionRateURL){
			this.feed('No conversion rate URL set.', true);
			return;
		}
		$.get(conversionRateURL, (data) => {
			if(!data || !Array.isArray(data) || data.length < 1){
				this.feed('Array min length of 1 expected for conversion rates.', true);
				return;
			}
			this.conversionRates = data;
			const conversionRateIndicator = document.getElementById('conversion_rate');
			if(conversionRateIndicator){
				const cryptoPrice = this.satoshiToFiatStr(this.cryptoToSatoshi(1));
				conversionRateIndicator.textContent = `1 ₿ = ${cryptoPrice}`;
			}
			this.loadWalletSelector();
		});
	}

	satoshiToCrypto(satoshi){
		if(isNaN(satoshi*1) || satoshi < 1 || satoshi % 1 > 0) return 0;
		return satoshi / 100_000_000;
	}

	cryptoToSatoshi(crypto_amount){
		if(isNaN(crypto_amount*1)) return 0;
		return Math.floor(crypto_amount * 100_000_000);
	}

	cryptoToFiatStr(crypto_amount){
		const fiat_code 	= this.getSetting('fiat_code');
		const curr_char		= this.fiatCodeToSymbol(fiat_code);
		const sats 			= this.cryptoToSatoshi(crypto_amount);
		const fiat_amount 	=this.satoshiToFiat(sats).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
		return `${curr_char}${fiat_amount}`;
	}

	fiatToSatoshi(fiat_amount, altFiatCode = null){
		if(isNaN(fiat_amount*1)) return 0;
		var fiat_code = this.getSetting('fiat_code');
		if(altFiatCode && typeof altFiatCode == 'string' && altFiatCode.length === 3){
			fiat_code = altFiatCode;
		}
		const rate = this.conversionRates.find(rate => rate.code === fiat_code);
		if(!rate || !rate.rate || isNaN(rate.rate*1)) return 0;
		return this.cryptoToSatoshi(fiat_amount / rate.rate);
	}

	satoshiToFiat(satoshi, altFiatCode = null){
		if(isNaN(satoshi*1) || satoshi % 1 > 0) return 0;
		var fiat_code = this.getSetting('fiat_code');
		if(altFiatCode && typeof altFiatCode == 'string' && altFiatCode.length === 3){
			fiat_code = altFiatCode;
		}
		const rate = this.conversionRates.find(rate => rate.code === fiat_code);
		if(!rate || !rate.rate || isNaN(rate.rate*1)) return 0;
		const fiat_amount = (satoshi / 100_000_000) * rate.rate;
		return fiat_amount;
	}

	fiatToCryptoStr(fiat_amount){
		return this.satoshiToCrypto(this.fiatToSatoshi(fiat_amount)) + " ₿";
	}

	fiatToSatoshiStr(fiat_amount){
		return this.fiatToSatoshi(fiat_amount) + " sats";
	}

	satoshiToCryptoStr(satoshi){
		return this.satoshiToCrypto(satoshi) + " ₿";
	}

	satoshiToFiatStr(satoshi){
		const fiat_code = this.getSetting('fiat_code');
		if (!fiat_code) return "---";
		const curr_char		= this.fiatCodeToSymbol(fiat_code);
		var curr_accuracy 	= 2; // TODO: Add special cases for certain fiat codes
		return curr_char + this.satoshiToFiat(satoshi).toLocaleString(undefined, { minimumFractionDigits: curr_accuracy, maximumFractionDigits: curr_accuracy });
	}

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
	
	rebuildSettingsForm() {
        const form = document.getElementById('settings_form');
		if(!form) return;
        form.innerHTML = ''; // Clear the form

		// Get alpha sorted keys from this.state.settings
		const sortedKeys = Object.keys(this.settingsDefault).sort();

        for (var i=0; i<sortedKeys.length; i++) {
			const key  	= sortedKeys[i];
            const label = document.createElement('label');
            label.textContent = key.replace(/_/g, ' ').toUpperCase();
            form.appendChild(label);

            let input;
            if (typeof this.settingsDefault[key] === 'boolean') {
                input = document.createElement('select');
                ['true', 'false'].forEach(optionValue => {
                    const option = document.createElement('option');
                    option.value = optionValue;
                    option.text = optionValue.charAt(0).toUpperCase() + optionValue.slice(1);
                    if (String(this.state.settings?.[key]) === optionValue) {
                        option.selected = true;
                    }
                    input.appendChild(option);
                });
            } else {
                input = document.createElement('input');
                input.type = typeof this.settingsDefault[key] === 'number' ? 'number' : 'text';
				if(input.type == 'number' && key in this.settingsLimits){
					const limits = this.settingsLimits[key];
					input.min = limits[0];
					input.max = limits[1];
				}
                input.value = this.state.settings?.[key] || this.settingsDefault[key];
            }
            input.name = key;
            form.appendChild(input);

			if(key == 'server_url'){
				// Get all server_urls from invoices in this.state.invoices
				var server_urls = [];
				for (let name in this.state.invoices) {
					if(this.state.invoices[name].server_url && typeof this.state.invoices[name].server_url == 'string'){
						server_urls.push(this.state.invoices[name].server_url);
					}
				}
				// Make server_urls unique and alpha sorted
				server_urls = [...new Set(server_urls)].sort();
				// Add a button to set the input value to each of the available server_urls
				server_urls.forEach(server_url => {
					const urlset = document.createElement('a');
					urlset.textContent = `Set to ${server_url}`;
					urlset.addEventListener('click', () => {
						input.value = server_url;
					});
					form.appendChild(urlset);
					form.appendChild(document.createElement('br'));
				});
				form.appendChild(document.createElement('br'));
				form.appendChild(document.createElement('br'));
			}else if(key == 'fiat_code'){
				// Get all fiat_codes from conversion rates
				const fiat_codes = this.conversionRates.map(rate => rate.code).sort();
				// Add a button to set the input value to each of the available fiat_codes
				fiat_codes.forEach(fiat_code => {
					const fiatCodeSet = document.createElement('a');
					fiatCodeSet.textContent = fiat_code;
					fiatCodeSet.style.paddingRight = '5px';
					fiatCodeSet.style.paddingLeft = '5px';
					fiatCodeSet.style.cursor = 'pointer';
					fiatCodeSet.addEventListener('click', () => {
						input.value = fiat_code;
					});
					form.appendChild(fiatCodeSet);
				});
				form.appendChild(document.createElement('br'));
				form.appendChild(document.createElement('br'));
			}
        }

        // Add the submit button
        const submitButton = document.createElement('button');
        submitButton.type = 'submit';
		submitButton.classList.add('submit_settings_button');
        submitButton.textContent = 'Save Settings';
        form.appendChild(submitButton);
    }

	loadWalletSelector(){
		const currentCaptcha		= this.currentCaptcha;
		const previouslySelected 	= $('#wallet_selector').val();
		// sort invoices by balance in decending order
		try{
			const sortedInvoices 		= Object.keys(this.state.invoices || {}).sort((a, b) => this.state.invoices[b].balance - this.state.invoices[a].balance );
			// save user selection
			$('#wallet_selector').empty();
			const server_url 			= this.getSetting('server_url');
			for (var i=0; i<sortedInvoices.length; i++){
				var captchaId 	= sortedInvoices[i];
				var invoice 	= this.state.invoices[captchaId];
				if(invoice.server_url !== server_url) continue; // skip invoices for other servers
				var balance 	= (invoice.balance && !isNaN(invoice.balance))? invoice.balance: 0;
				if(balance < 1) continue; // skip empty wallets
				var captchaName = captchaId.substring(0, 8) + '...';
				if(invoice?.alias) captchaName = invoice.alias.toString();
				const option 	= $(`<option value="${captchaId}">${String(balance)}  |  ${this.satoshiToFiatStr(balance)}  |  ${captchaName}</option>`);
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
				if(!this.currentCaptcha || typeof this.currentCaptcha != 'string' || this.currentCaptcha.toLowerCase().trim() == 'free') return; 

				// Make sure the user is verified
				const alias = this.state.invoices[this.currentCaptcha]?.alias || null;
				if(!alias || typeof alias != 'string' || !alias.startsWith('$')) return;

				// fetch the channels for this account.
				const formData = new FormData();
				formData.append('captcha_id', this.currentCaptcha);
				formData.append('secret', app.getInvoiceSecret(this.currentCaptcha));
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
					channelSelector.off();
					if(channels.length > 0){
						channelSelector.empty().append(`<option value="">Select Channel - ${channels.length}</option>`);
						channels.forEach((channel) => {
							channelSelector.append(`<option value="${channel}">${channel}</option>`);
						});
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
			});
			$('#wallet_selector').trigger('change');
		}catch(e){
			console.error(e);
		}
	}

	getSelectedWalletID(){
		return $('#wallet_selector').val();
	}

	getSelectedWalletBalance(){
		const selectedWalletID = this.getSelectedWalletID();
		if(selectedWalletID === 'free') return 0;
		return this.state.invoices[selectedWalletID]?.balance || 0;
	}
	
	buildWalletForm(){
        $('#nav-close').show(300);

		// Create wallet form
		const buyFormContainer = $('<div class="buy_form_container" style="display:none;"></div>');
        const buyForm = $(
            '<form>' + 
                '<label for="number-input">Amount:</label>' + 
                '<input type="number" id="buy_val" name="number-input" required="">' + 
                '<label for="select-input">Currency:</label>' + 
                '<select id="buy_curr" name="select-input" required="">' + 
                    '<option value="usd">USD</option>' + 
                '</select>' + 
                '<input type="submit" value="Buy!">' + 
            '</form>'
        );
		buyForm.submit((e) => {
			e.preventDefault();
			this.createWallet($('#buy_val').val(), $('#buy_curr').val());
		});
		const cancelIcon = this.heroicon('x-mark').outerHTML || '❌';
		const buyFormCancel = $(`<a href="#" id="cancel_buy_wallet" class="pull-right faded" title="Cancel Wallet Creation">${cancelIcon}&nbsp;Cancel</a>`);
		buyFormCancel.on('click', (e) => {
			e.preventDefault();
			$('.buy_form_container').slideUp(200);
		});
        buyFormContainer.append('<hr><h2>Create a new Wallet</h2>',buyForm,'<br>&nbsp;',buyFormCancel,'<hr>');

        // wallet list
		const h2 = $('<h2>My&nbsp;Wallets&nbsp;</h2>');
		const plus = $(`<a href="#" id="add_wallet" title="Add a new wallet">${this.heroicon('plus').outerHTML}</a>`);
		plus.on('click', (e) => {
			e.preventDefault();
			$('.buy_form_container').toggle(200);
		});
		h2.append(plus);
		$('#form_container').empty().css({display:'block'}).addClass('wallet_list').append(h2,buyFormContainer);
		
		var total_invoices = 0, server_invoices = 0;
		const date_sorted_invoice_keys = Object.keys(this.state.invoices).sort((a, b) => {
			const dateA = new Date(this.state.invoices[a].created);
			const dateB = new Date(this.state.invoices[b].created);
			return dateB - dateA;
		});
        var invoiceDivs = [];
		for (var i=0; i<date_sorted_invoice_keys.length; i++){
			var name = date_sorted_invoice_keys[i];

			total_invoices++;

			// We only want invoices for the current server
			if (this.state.invoices[name].server_url !== this.getSetting('server_url')) {
				continue;
			}

			server_invoices++;

			const invoice = JSON.parse(JSON.stringify(this.state.invoices[name]));
			// Create a div for each invoice
			const alias = invoice?.alias || null;
			const use_name      = alias? alias: name.substring(0, 8);
            const inv_link      = invoice.link? `<a href="${invoice.link}" target="_blank">${this.heroicon('clipboard-document').outerHTML}&nbsp;Invoice Link</a>`: 'No invoice link';
			const pay_class     = this.cryptoToSatoshi(invoice.btc_paid)? 'paid': 'unpaid';
            const bal_class     = invoice.balance > 0? 'balance': 'no_balance';
			const invoiceDiv    = $(
                `<div class="card invoice" data-captcha-id="${name}" data-date-created="${invoice.created}" data-balance="${invoice.balance}">` + 
                    `<a class="invoice_server_link" href="${invoice.server_url}" target="_blank">${invoice.server_url.replace('https://','').replace('http://','')}</a><br>` +
                    `<strong class="${bal_class} alias_strong" style="font-size:1.6em;">${use_name}</strong><br>` +
                    `Rate Quote: ${invoice.rate_quote} sat${( invoice.rate_quote == 1? '': 's' )}<br>` +
                    `Payment: <span class="${pay_class}">${invoice.btc_paid} (${this.cryptoToFiatStr(invoice.btc_paid)})</span><br>` +
                    `Balance: <span class="${bal_class}">${invoice.balance} sat${( invoice.balance == 1? '': 's' )} (${this.satoshiToFiatStr(invoice.balance)})</span><br>` +
                    `Created: ${invoice.created}<br>` +
                    inv_link + 
                `</div>`
            );

			var repoElement = $('<span class="faded" style="text-decoration:line-through;" title="No recovery phrase found.">Recovery Phrase</span>');
			if(invoice.repo){
				repoElement = $(`<a href="#" title="Copy Recovery Phrase to clipboard">${this.heroicon('clipboard-document').outerHTML}&nbsp;Recovery Phrase</a>`);
				repoElement.on('click', (e) => {
					e.preventDefault();
					const targ = $(e.currentTarget);
					navigator.clipboard.writeText(invoice.repo);
					this.feed('Recovery Phrase copied to clipboard.',false,targ);
					targ.animate({opacity: 0}, 300, ()=>{ targ.animate({opacity: 1}, 300); });
				});
			}

			const redeemLink = $(`<a href="#" data-captcha-id="${name}" class="invoice_redeem_link" title="Redeem/Refresh this invoice">${this.heroicon('arrow-path').outerHTML}&nbsp;Update Balance</a>`);
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
			const payoutLink = $(`<a href="#" data-captcha-id="${name}" class="invoice_payout_link pull-right" title="Request a payout for this invoice">${this.heroicon('arrow-down-on-square').outerHTML}&nbsp;Withdraw</a>`);
			payoutLink.click((e) => {
				e.preventDefault();
				// Get the captcha ID from the clicked element
				const targ 			= $(e.currentTarget);
				const captchaId 	= targ.attr('data-captcha-id');
				const secret 		= this.state.invoices[captchaId]?.secret || null;
                if(!secret){
                    this.feed('No secret found for this invoice.', true);
                    return;
                }
				const sentToAddress = prompt('Enter the BTC address to send the funds to:');
				if (!sentToAddress){
					this.feed("Action Cancelled.");
					return;
				};
				if(typeof sentToAddress !== 'string' || sentToAddress.trim().length < 26){
					this.feed("BTC receiving address must be at least 26 characters.");
					return;
				}
				const server_url = this.getSetting('server_url');
				if(!server_url || typeof server_url != 'string' || !server_url.startsWith('http')){
					this.feed('No server URL set.', true);
					return;
				}
				const payoutEndpoint = `${server_url}/get_funds`;
				const formData = new FormData();
				formData.append('captcha_id', captchaId);
				formData.append('secret', secret);
				formData.append('send_to_address', sentToAddress.trim());
				// Send the POST request to redeem the invoice
				fetch(payoutEndpoint, {
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
						return;
					}
					if(data.msg) this.feed(data.msg);
					const req = data.payout_request;
					if(
						!req || typeof req != 'object' || 
						!("satoshi_withdrawal" in req) || !req.satoshi_withdrawal || isNaN(req.satoshi_withdrawal*1) ||
						!("send_to_address" in req) || !req.send_to_address || typeof req.send_to_address != 'string' || req.send_to_address.length < 26 || 
						!("btcpay_id" in req) || !req.btcpay_id || typeof req.btcpay_id != 'string' || req.btcpay_id.length < 3
					){
						this.feed('There was a problem with the payout request.', true);
						return;
					}
					req.satoshi_withdrawal = req.satoshi_withdrawal*1;
					this.state.invoices[captchaId].payout_requests = data.payout_requests || [];
					this.state.invoices[captchaId].payout_requests.push(req);
					this.redeemInvoice(captchaId);
				})
				.catch(error => {
					this.feed('There has been a problem with your fetch operation. See console.', true);
					console.error(error);
				});
			});

			const verifyLink = $(`<a href="#" class="invoice_verify_link" data-captcha-id="${name}" title="Get a verified username for this virtual wallet">&nbsp;&nbsp;${this.heroicon('pencil').outerHTML}</a>`);
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
				const cancelIcon = this.heroicon('x-mark').outerHTML || '❌';
				const cancelVerificationLink = $(
					`<a href="#" class="invoice_verification_cancel_link faded" style="display:inline-block;margin-bottom:15px;margin-left:15px;">
						${cancelIcon}&nbsp;&nbsp;<span style="font-style:italic;">Cancel</span>
					</a>`
				);
				cancelVerificationLink.on('click', (e) => {
					e.preventDefault();
					$('.invoice_verification_form').remove();
					$('.invoice_verification_cancel_link').remove();
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
						<strong class="error">WARNING:</strong> This account will no longer be anonymous after adding a nickname or a verified username. You will need to create/use a different account to post anonymously again.
					</form>`
				);

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
										const input = document.querySelector(`input[name="username_submission"][data-captcha-id="${captchaId}"]`);
										input.value = e.target.value.replace(/\$/g,'').replace(/_/g,' ');
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
							const stats = this.fiatToSatoshi(fee, unit);
							const fiatStr = this.satoshiToFiatStr(stats, unit);
							feeStr = `${fiatStr} (${stats} sats)`;
						}
						document.querySelectorAll('.user_verification_fee').forEach((el) => el.textContent = feeStr);
					});
				});
				targ.after(cancelVerificationLink);
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
			if(invoice.balance) invoiceDiv.find('.invoice_server_link').after(payoutLink);
			invoiceDiv.find('.alias_strong').after(verifyLink);
			invoiceDiv.append('<br>',redeemLink);
			invoiceDiv.append('<br>',repoElement);
            invoiceDivs.push(invoiceDiv);
		}

		// Tell users how many invoices they have
        const svr_url = this.getSetting('server_url');
        const ttl_str = total_invoices > server_invoices? `Total Wallets: ${total_invoices}<br>`: '';
		$('#form_container').append(`${ttl_str}<a href="${svr_url}">${svr_url.replace('https://','')}</a> wallets: ${server_invoices}`);

        // Append the invoice divs to #form_container
        invoiceDivs.forEach(div => {
            $('#form_container').append(div);
        });

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
        $('#form_container').append('<hr><h2>Recover a Wallet',recoveryForm);
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
				});
				this.saveState();
			}
		})
		.catch(error => {
			this.feed('Failed to redeem invoice.', true, $(`.invoice[data-captcha-id="${captchaId}"]`));
			console.error(error);
            this.buildWalletForm();
		})
		.finally(() => {
			this.buildWalletForm();
			this.loadWalletSelector();
		});
	}

	heroicon(name) {
		const svgContainer = document.getElementById('heroicon-' + name);
		if (svgContainer) {
			const svg = svgContainer.querySelector('svg');
			if (svg) return svg.cloneNode(true);
		}
		return false;
	}

	scrollDown() {
		this.newMessages = 0;
		this.skipAutoScroll = false;
		$('#scroll_to_bottom_container').addClass('faded');
		setTimeout(() => {
			$('#gui').animate({ scrollTop: $('#gui').prop('scrollHeight') }, 400);
		}, 10);
	}
}
