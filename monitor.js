/* App State */
class AppState {
	constructor() {
		this.state				= {};
		this.settingsSchema 	= {};
		this.settingsDefault 	= {
			server_url: 			"http://localhost:5000",
			thread_refresh_rate: 	3000,
			autoload_threads: 		false,
			url_preview_max_len: 	50,
			min_spend_threshold: 	1
		};
		for (let key in this.settingsDefault) this.settingsSchema[key] = typeof this.settingsDefault[key];
		this.loadState();
	}

	// Load the state from chrome.storage.local
	loadState() {
		chrome.storage.local.get(['available_keys', 'spent_keys', 'invoices', 'current_user_url', 'settings'], (result) => {
			if (chrome.runtime.lastError) {
				console.error('Error loading state:', chrome.runtime.lastError);
				return;
			}
			this.state.available_keys 	= result.available_keys 	|| [];
			this.state.spent_keys 		= result.spent_keys 		|| [];
			this.state.invoices 		= result.invoices 			|| {};
			this.state.current_user_url = result.current_user_url 	|| '';
			this.state.settings 		= result.settings 			|| {};

			if (Object.keys(this.state.settings).length < Object.keys(this.settingsDefault).length) {
				this.state.settings = JSON.parse(JSON.stringify(this.settingsDefault));
			}

			this.rebuildSettingsForm();
			this.rebuildInvoiceList();

			chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => { 
				if (tabs.length > 0) this.updateCurrentUserURL(tabs[0].url, false);
			});
		});
	}

	// Save the current state to chrome.storage.local
	saveState() {
		chrome.storage.local.set(this.state, () => {
			if (chrome.runtime.lastError) {
				console.error('Error saving state:', chrome.runtime.lastError);
			}
		});
	}
	
	// Add a key to available_keys
	addKeys(keys) {
		if (!Array.isArray(keys) || !keys.every(key => typeof key === 'string')) {
			this.feed('Invalid input: keys should be an array of strings.',true);
			return;
		}
		keys.forEach(key => {
			if (!this.state.available_keys.includes(key)) {
				this.state.available_keys.push(key);
			}
		});
		this.saveState();
	}
	
	// Saves invoice to state
	addInvoice(captcha, val, curr){
		this.state.invoices[captcha] = {
			num_keys_downloaded: 	0, // Updated when user takes delivery of keys.
			created:				new Date().toISOString(),
			val:					val,
			curr:					curr,
			secret:					null,
		};
		this.rebuildInvoiceList();
		this.saveState();
	}
	
	buyKeys(val, curr) {
		const settings 	= this.getSettings();
		const buyEndpoint 	= `${settings.server_url}/buy?val=${encodeURIComponent(val)}&cur=${encodeURIComponent(curr)}`;
		fetch(buyEndpoint)
			.then(response => {
				if (response.ok) {
				return response.text();
				} else {
				throw new Error('Network response was not ok');
				}
			})
			.then(captchaId => {
				const settings 	= this.getSettings();
				this.addInvoice(captchaId,val,curr);
				this.feed(`Received Captcha ID: ${captchaId}`);
				
				// Create a form dynamically
				const form = document.createElement('form');
				form.method = 'POST';
				form.action = `${settings.server_url}/request_invoice_creation`;
				form.target = '_blank';

				// Create an input element for the captcha ID
				const input = document.createElement('input');
				input.type = 'hidden';
				input.name = 'captcha_id';
				input.value = captchaId;

				// Append the input to the form, ppend the form to the body (needed for submission), submit, and then remove.
				form.appendChild(input);
				document.body.appendChild(form);
				form.submit();
				document.body.removeChild(form);
			})
			.catch(error => {
				this.feed('There has been a problem with your fetch operation. See console.', true);
				console.error(error);
			});
	}

	// Move a key from available_keys to spent_keys and return array of newly spent keys for API use.
	spendKeys(n = 1) {
		let spentKeys = [];
		if(this.state.available_keys.length >= n){
			while(n > 0){
				spentKey = this.state.available_keys.pop();
				this.state.spent_keys.push(spentKey);
				n--;
			}
			this.saveState();
		}
		return spentKeys;
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
					validSettings[key] = newSettings[key]*1;
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
			this.state.settings = { ...this.state.settings, ...validSettings };
			this.saveState();
			this.feed("Settings updated.")
		}

	}

	// Getters for the state
	getAvailableKeys() {
		return this.state.available_keys;
	}

	getSpentKeys() {
		return this.state.spent_keys;
	}
	
	getInvoices() {
		return this .state.invoices;
	}

	getSettings() {
		return this.state.settings;
	}

	getCurrentURL() {
		return this.state.current_user_url;
	}
	
	getShortURL(){
		const settings 	= this.getSettings();
		const url 		= this.getCurrentURL();
		var shortUrl 	=  url.substr(0,settings.url_preview_max_len);
		return url.length > settings.url_preview_max_len? shortUrl + "...": url + "";
	}

	// GUI Output
	updateCurrentUserURL(url, save_state = true) {
		this.state.current_user_url 						= url.toString();
		document.getElementById('current_url').title 		= this.getCurrentURL();
		document.getElementById('current_url').innerHTML 	= this.getShortURL();
		this.saveState();
	}
	
	feed(arg, err = false){
		console.log(arg,err);
		const f 		= document.getElementById('feed');
		f.innerHTML 	= arg.toString();
		f.title		 	= arg.toString();
		f.style.color 	= err? "rgb(255,0,0)": "rgb(1,64,54)";
	}
	
	rebuildSettingsForm() {
        const form = document.getElementById('settings_form');
        form.innerHTML = ''; // Clear the form

        for (let key in this.state.settings) {
            const label = document.createElement('label');
            label.textContent = key.replace(/_/g, ' ').toUpperCase();
            form.appendChild(label);

            let input;
            if (typeof this.state.settings[key] === 'boolean') {
                input = document.createElement('select');
                ['true', 'false'].forEach(optionValue => {
                    const option = document.createElement('option');
                    option.value = optionValue;
                    option.text = optionValue.charAt(0).toUpperCase() + optionValue.slice(1);
                    if (String(this.state.settings[key]) === optionValue) {
                        option.selected = true;
                    }
                    input.appendChild(option);
                });
            } else {
                input = document.createElement('input');
                input.type = typeof this.state.settings[key] === 'number' ? 'number' : 'text';
                input.value = this.state.settings[key];
            }
            input.name = key;
            form.appendChild(input);
        }

        // Add the submit button
        const submitButton = document.createElement('button');
        submitButton.type = 'submit';
        submitButton.textContent = 'Save Settings';
        form.appendChild(submitButton);
    }
	
	rebuildInvoiceList(){
		const container = document.getElementById('invoice_container');
        container.innerHTML = '';
		for (let name in this.state.invoices) {
			const invoice = JSON.parse(JSON.stringify(this.state.invoices[name]));
			// Create a div for each invoice
			const invoiceDiv = document.createElement('div');
			invoiceDiv.setAttribute("data-captcha-id",name);
			invoiceDiv.setAttribute("data-date-created",invoice.created);
			invoiceDiv.classList.add('invoice');

			// Create and append invoice details
			const numKeysDownloaded = document.createElement('p');
			numKeysDownloaded.textContent = `Number of Keys Downloaded: ${invoice.num_keys_downloaded}`;
			invoiceDiv.appendChild(numKeysDownloaded);

			const created = document.createElement('p');
			created.textContent = `Created: ${invoice.created}`;
			invoiceDiv.appendChild(created);

			const val = document.createElement('p');
			val.textContent = `Purchase Price: ${invoice.val} ${invoice.curr}`;
			invoiceDiv.appendChild(val);

			// Only add redeem link if not already redeemed.
			// We can skip this step if the invoice has been paid or if it has been marked "invalid captcha".
			if(1){ 
				const redeemLink = document.createElement('a');
				redeemLink.textContent = `Redeem`;
				redeemLink.setAttribute("data-captcha-id",name);
				redeemLink.addEventListener('click', (e) => {
					// If the invoice does not have a secret, request it by POSTing the captcha_id to the /redeem_invoice endpoint.
					const captchaId = e.target.getAttribute('data-captcha-id');
					const settings = this.getSettings();
					const redeemEndpoint = `${settings.server_url}/redeem_invoice`;
					const formData = new FormData();
					formData.append('captcha_id', captchaId);

					// Send the POST request to redeem the invoice
					fetch(redeemEndpoint, {
						method: 'POST',
						body: formData
					}).then(response => {
						if (response.ok) {
							return response.text();
						} else {
							throw new Error('Network response was not ok');
						}
					}).then(json => {	
						const data = JSON.parse(json);
						if(data.secret){
							this.state.invoices[captchaId].secret = data.secret;
							this.rebuildInvoiceList();
						}else{
							alert("ERROR: Could not redeem invoice. See console for details.");
							console.error(data);
						}
					}).catch(error => {
						this.feed('There has been a problem with your fetch operation. See console.', true);
						console.error(error);
					});
				});
				invoiceDiv.appendChild(redeemLink);
			}

			// Append the invoice div to the container
			container.appendChild(invoiceDiv);
		}
		
		// Sort by date created with newest at top.
		const elements = Array.from(container.children);
		elements.sort((a, b) => {
			const dateA = new Date(a.getAttribute('data-date-created'));
			const dateB = new Date(b.getAttribute('data-date-created'));
			return dateA - dateB;
		});
		elements.forEach(element => container.appendChild(element));
	}
}

/* Initialize app state */
const app = new AppState();

/* Extension functionality */
chrome.runtime.onMessage.addListener((message) => {
	if (message.url) {
		app.updateCurrentUserURL(message.url);
	}
});

/* Named functions */
function showTab(tabId) {
	const tabs = document.querySelectorAll('.tab');
	const tabContents = document.querySelectorAll('.tab-content');

	tabs.forEach(tab => {
		if (tab.id === `tab-${tabId}`) {
			tab.classList.add('active');
		} else {
			tab.classList.remove('active');
		}
	});

	tabContents.forEach(content => {
		if (content.id === tabId) {
			content.classList.add('active');
		} else {
			content.classList.remove('active');
		}
	});
}

/* Listeners */
document.getElementById('tab-home').addEventListener('click', () => showTab('home'));
document.getElementById('tab-buy').addEventListener('click', () => showTab('buy'));
document.getElementById('tab-settings').addEventListener('click', () => showTab('settings'));
document.getElementById('buy_form').addEventListener('submit', (event) => {
	event.preventDefault();
	app.buyKeys(document.getElementById('buy_val').value, document.getElementById('buy_curr').value);
});
document.getElementById('settings_form').addEventListener('submit', (event) => {
	event.preventDefault();
	const form = event.target;
	const formData = new FormData(form);
	const formObject = {};
	formData.forEach((value, key) => {
		formObject[key] = value;
	});
	app.updateSettings(formObject);
});