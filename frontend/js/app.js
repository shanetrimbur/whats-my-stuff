const video = document.getElementById('camera');
const canvas = document.getElementById('snapshot');
const context = canvas.getContext('2d');
const captureButton = document.getElementById('capture');

navigator.mediaDevices.getUserMedia({ video: true })
    .then(stream => {
        video.srcObject = stream;
    });

captureButton.addEventListener('click', () => {
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    const imageData = canvas.toDataURL('image/png');
    fetch('../backend/save_image.php', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'image=' + encodeURIComponent(imageData),
    })
    .then(response => response.json())
    .then(data => {
        alert('Image captured and processed!');
    });
});
