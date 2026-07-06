const video = document.getElementById('camera');
const canvas = document.getElementById('snapshot');
const context = canvas.getContext('2d');
const captureButton = document.getElementById('capture');
const statusMessage = document.getElementById('status');
const itemsContainer = document.getElementById('items');

function setStatus(message, type = '') {
    statusMessage.textContent = message;
    statusMessage.className = type;
}

function renderItems(items) {
    itemsContainer.innerHTML = '';

    if (items.length === 0) {
        itemsContainer.innerHTML = '<p class="empty-state">No items captured yet.</p>';
        return;
    }

    items.forEach(item => {
        const card = document.createElement('article');
        card.className = 'item-card';

        if (item.image_url) {
            const image = document.createElement('img');
            image.src = item.image_url;
            image.alt = item.title;
            card.appendChild(image);
        }

        const body = document.createElement('div');
        body.className = 'item-card__body';

        const title = document.createElement('h3');
        title.textContent = item.title;
        body.appendChild(title);

        const tags = document.createElement('div');
        tags.className = 'tags';
        item.tags.forEach(tag => {
            const tagElement = document.createElement('span');
            tagElement.textContent = tag;
            tags.appendChild(tagElement);
        });
        body.appendChild(tags);

        card.appendChild(body);

        itemsContainer.appendChild(card);
    });
}

async function loadItems() {
    const response = await fetch('../backend/marketplace/list_items.php');
    const data = await response.json();

    if (!response.ok || data.status !== 'success') {
        throw new Error(data.message || 'Unable to load items');
    }

    renderItems(data.items);
}

async function startCamera() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true });
        video.srcObject = stream;
        setStatus('Camera ready.');
    } catch (error) {
        captureButton.disabled = true;
        setStatus('Camera access failed. Check browser permissions.', 'error');
    }
}

captureButton.addEventListener('click', async () => {
    if (!video.videoWidth || !video.videoHeight) {
        setStatus('Camera is not ready yet.', 'error');
        return;
    }

    captureButton.disabled = true;
    setStatus('Saving captured item...');

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    const imageData = canvas.toDataURL('image/png');

    try {
        const response = await fetch('../backend/save_image.php', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: 'image=' + encodeURIComponent(imageData),
        });
        const data = await response.json();

        if (!response.ok || data.status !== 'success') {
            throw new Error(data.message || 'Unable to save captured item');
        }

        setStatus('Image captured and saved.', 'success');
        await loadItems();
    } catch (error) {
        setStatus(error.message, 'error');
    } finally {
        captureButton.disabled = false;
    }
});

startCamera();
loadItems().catch(error => setStatus(error.message, 'error'));
