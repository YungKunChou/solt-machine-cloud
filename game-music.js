document.addEventListener('DOMContentLoaded', () => {
    let player;
    let isMusicPlaying = false;
    let isMusicPlayerReady = false;
    const setMusicButton = (isPlaying) => {
        isMusicPlaying = isPlaying;
        document.getElementById('toggle-music-btn').textContent = isPlaying ? '🔊 關閉背景音樂' : '🔇 開啟背景音樂';
    };
    window.onYouTubeIframeAPIReady = function() {
        player = new YT.Player('youtube-player', {
            height: '200',
            width: '200',
            videoId: 'P4YzQmd9tZo',
            playerVars: { listType: 'playlist', list: 'PLbYHhP_Esm05t_qgCEeI9K3-8WECKWxDD', loop: 1, playsinline: 1 },
            events: {
                onReady: (event) => { isMusicPlayerReady = true; event.target.setVolume(50); setMusicButton(false); },
                onStateChange: (event) => {
                    if (event.data === YT.PlayerState.PLAYING) setMusicButton(true);
                    if (event.data === YT.PlayerState.PAUSED || event.data === YT.PlayerState.ENDED) setMusicButton(false);
                }
            }
        });
    };

    document.getElementById('toggle-music-btn').addEventListener('click', () => {
        if (!player || !isMusicPlayerReady) {
            document.getElementById('toggle-music-btn').textContent = '音樂載入中...';
            return;
        }
        if (isMusicPlaying) { player.pauseVideo(); setMusicButton(false); }
        else { player.playVideo(); setMusicButton(true); }
    });


});
