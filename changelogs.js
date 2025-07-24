// changelogs.js

// 1. Your changelog data
window.changelogs = [
  { version: "v11.1 24.07.2025", description: "Updated Site to be more polished and smoother." },
  { version: "v11.0 23.07.2025", description: "Added Anime: My Teen Romantic Comedy S2 & The Rising Of The Shield Hero S2 | Added Top Gear S1 - S22 | Updated Site to be more polished and smoother." },
  { version: "v10.0 16.06.2025", description: "Added Anime: My Teen Romantic Comedy & The Rising Of The Shield Hero | Added Show: Barry S4 | Updated Site to look better and the Whole fucking code and site is a lot more polished and smoother." },
  { version: "v9.3.0 31.05.2025", description: "Added Films: Nobody, Lord Of War | Added Anime: Saga Of Tanya The Evil | Added Show: Barry S3 | Finished Adding ReZero S3 Dub and Download." },
  { version: "v9.2.0 18.05.2025", description: "Added OPM S2, Added The Boys S1 - S4" },
  { version: "v9.1.0 20.04.2025", description: "Added OPM Subs and Download, Added back Invincible S1-3, Added back Barry S1-2, Added back Padomju Dzinsi, Most Movies added back By Kris from Lunora! Movies are now done by the Lunora team" },
  { version: "v9.0.6 20.04.2025", description: "Added back almost all of the anime back, Added OPM for Easter Update! Happy Easter!" },
  { version: "v9.0.4 15.04.2025", description: "Added back half of the anime back, other half coming soon | Fixed bug with when you watch and press back to category list it now deloads the video and doesnt play it in the background." },
  { version: "v9.0.1 30.03.2025", description: "Added Padomju Džinsi early (special request)" },
  { version: "v9.0 29.03.2025", description: "Anime and Shows content now has the content splitted on a drop down Season! | Added ALMOST Rest of the Re:ZERO Content | Added The Mask of Zorro 1998 | Redo Of Healer, One Punch Man, Rest of The Grand Tour coming soon next Friday Update!" },
  { version: "v8.2.1 25.03.2025", description: "Added rest of S3 Invincible Episodes (PURALADE request) | Added Re:Zero S3" },
  { version: "v8.2 20.03.2025", description: "Added Barry S2 | Removed Main Menu site and added all features from the Main Menu one to this one | More content coming soon." },
  { version: "v8.1 16.03.2025", description: "Added Barry S1 | Added Re:Zero S2 SUBS and DOWNLOAD | More content coming soon." },
  { version: "v8.0 15.03.2025", description: "Added CIAWWL2C | Splitted Content into Categories properly | Content Text System Rework (by yours trully chat gpt) | Added White Theme | More content coming soon." },
  { version: "v7.1 07.03.2025", description: "Added Re:Zero S2 | WILL ADDED OTHER LANGUAGE SUBTITLES AND DOWNLOAD LATER." },
  { version: "v7.0 02.03.2025", description: "Added Re:Zero S1 | Splitted Dubbed and Subbed Anime with a Button" },
  { version: "v6.8 01.03.2025", description: "Added The Grand Tour S3" },
  { version: "v6.7 27.02.2025", description: "Added More Than a Married Couple, But Not Lovers." },
  { version: "v6.6 26.02.2025", description: "Fixed Fullscreen button not Showing up on Smaller Devices | Added All Quiet On The Western Front | added Kick Ass" },
  { version: "v6.5 24.02.2025", description: "Added Konosuba S3" },
  { version: "v6.4 23.02.2025", description: "Added Taxi 1 - 3" },
  { version: "v6.3 21.02.2025", description: "Added Konosuba Megumin Spinoff | Last thing to add is Konosuba S3" },
  { version: "v6.2.1 21.02.2025", description: "Added Invincible S1 subs and download" },
  { version: "v6.2 20.02.2025", description: "Added Konosuba S2 | Added Konosuba Movie" },
  { version: "v6.1 15.02.2025", description: "Added Konosuba S1 | Added Invincible S1-S3 E4 (Subs & Download soon) | fixed Matrix other downloads and added baltic subs" },
  { version: "v6.0 15.02.2025", description: "Fixed Bug When Searching for Something Category doesnt disappear | Fixed Episode List | Added Sharpe" },
  { version: "v5.4 14.02.2025", description: "Ningen Fushin Adventurers Who Don't Believe in Humanity Will Save the World" },
  { version: "v5.3 09.02.2025", description: "Added The Matrix" },
  { version: "v5.2 01.02.2025", description: "Added Flow (the movie)" },
  { version: "v5.1 29.01.2025", description: "Improved Changelogs | Isekai Quartet a New World Subtitles Added" },
  { version: "v5.0 24.01.2025", description: "diff episode names | Isekai Quartet added ENG & JP | Miss kuroitsu JP added" },
  { version: "v4.5.2 21.01.2025", description: "Added Squid Game Season 1" },
  { version: "v4.5.1 02.01.2025", description: "Fixed Deadpool 2" },
  { version: "v4.5 24.12.2024", description: "added superhero movie and The NeverEnding Story" },
  { version: "v4.4 23.12.2024", description: "Added Home Alone 1 & 2" },
  { version: "v4.3 20.12.2024", description: "Added The Grand Tour Season 2 all Episodes." },
  { version: "v4.2 19.12.2024", description: "Added Tour De Pharmacy | fixed fight club thumbnail" },
  { version: "v4.1 15.12.2024", description: "added truman show and fight club download links" },
  { version: "v4.0 14.12.2024", description: "added content and stuff" },
  { version: "v3.0 11.12.2024", description: "Virowatch beta 3 | more content, last thing left is to add all the shows" },
  { version: "v2.0 10.12.2024", description: "Virowatch beta 2 | added more content, not everything is added yet" },
  { version: "v1.0 09.12.2024", description: "Virowatch officially Uploaded" },
  // ... rest of your entries ...
];

// 2. When the DOM is ready:
document.addEventListener('DOMContentLoaded', () => {
  const container = document.getElementById('changelog-container');
  if (!container) return;

  // Render each entry
  container.innerHTML = ''; 
  window.changelogs.forEach(log => {
    const box = document.createElement('div');
    box.className = 'changelog-box';
    box.innerHTML = `<h3>${log.version}</h3><p>${log.description}</p>`;
    container.appendChild(box);
  });

  // 3. Auto‑hide on category clicks
  document.querySelectorAll('.movie-item-banner').forEach(b => {
    b.addEventListener('click', () => {
      container.style.display = 'none';
    });
  });

  // 4. Auto‑show on back button
  const backBtn = document.getElementById('backToCategory');
  if (backBtn) {
    backBtn.addEventListener('click', () => {
      // give your content.js a moment to reset views
      setTimeout(() => {
        container.style.display = 'block';
      }, 100);
    });
  }
});
