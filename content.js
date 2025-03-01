const movieItems = document.querySelectorAll('.movie-item');
const videoPlayer = document.getElementById('videoPlayer');
const searchInput = document.getElementById('searchInput');
const episodeContainer = document.getElementById('episodeContainer');
const episodeSidebar = document.getElementById('episodeSidebar');
const movieListWrapper = document.querySelector('.movie-list-wrapper');
const nextEpisodeButton = document.getElementById('nextEpisode');
const prevEpisodeButton = document.getElementById('prevEpisode');
const downloadContainer = document.getElementById('downloadContainer');
const banners = document.querySelectorAll('.movie-item-banner');

movieListWrapper.addEventListener("mouseenter", () => {
    movieListWrapper.addEventListener("wheel", handleWheel, { passive: false });
});

movieListWrapper.addEventListener("mouseleave", () => {
    movieListWrapper.removeEventListener("wheel", handleWheel);
});

function handleWheel(event) {
    event.preventDefault();
    movieListWrapper.scrollLeft += event.deltaY;
}

const movies = {
    kickass: {
        video: [
            'https://rumble.com/embed/v6ndl6f/?pub=4jqwl4'
        ],
        episodeTitles: [
            'Movie'
        ],
        customDownloads: [
        [
            { url: 'https://buzzheavier.com/whopoy87wur1', name: 'Buzzheavier download' },
],],},
    aqotwf: {
        video: [
            'https://rumble.com/embed/v6nd89f/?pub=4jqwl4',
            'https://rumble.com/embed/v6nd8ou/?pub=4jqwl4'
        ],
        episodeTitles: [
            'English',
            'German'
        ],
        customDownloads: [
        [
            { url: 'https://buzzheavier.com/cvyg0et9k0ar', name: 'ENG Buzzheavier download' },
        ],
        [
            { url: 'https://buzzheavier.com/m64h0ag4nyfl', name: 'GER Buzzheavier download' },
        ],
    ],
},
    taxi: {
        video: [
            'https://rumble.com/embed/v6m57ko/?pub=4jqwl4'
        ],
        episodeTitles: [
            'Movie'
        ],
        customDownloads: [
        [
            { url: 'https://buzzheavier.com/isdgapismhfl', name: 'Buzzheavier download' },
],],},
    taxi2: {
        video: [
            'https://rumble.com/embed/v6m57po/?pub=4jqwl4'
            ],
        episodeTitles: [
            'Movie'
        ],
        customDownloads: [
              [
                  { url: 'https://buzzheavier.com/92ijcwauaf9o', name: 'Buzzheavier download' },
],],},
    taxi3: {
         video: [
            'https://rumble.com/embed/v6m57y0/?pub=4jqwl4'
        ],
                episodeTitles: [
                     'Movie'
                ],
                customDownloads: [
                    [
                         { url: 'https://buzzheavier.com/95pceatgbamd', name: 'Buzzheavier download' },
],],},
    flow: {
        video: [
            'https://rumble.com/embed/v6dozw1/?pub=3u4il9'
        ],
        episodeTitles: [
            'Movie'
        ],
        customDownloads: [
            [
                { url: 'https://buzzheavier.com/7me4v4wzr0z6', name: 'Buzzheavier download' },
            ],],},
matrix1: {
        video: [
            'https://rumble.com/embed/v6g5qjj/?pub=3u4il9',
            'https://rumble.com/embed/v6ga9d7/?pub=3u4il9',
            'https://rumble.com/embed/v6gbcav/?pub=3u4il9',
            'https://rumble.com/embed/v6gboa4/?pub=3u4il9',
            'https://rumble.com/embed/v6gbwz1/?pub=3u4il9',
            'https://rumble.com/embed/v6gc9e4/?pub=3u4il9'
        ],
        episodeTitles: [
            'English',
            'French',
            'German',
            'Italian',
            'Spanish',
            'Japanese'
        ],
        customDownloads: [
            [
                { url: 'https://buzzheavier.com/xpgaf4yzncq1', name: 'Buzzheavier download' },
            ],
            [
                { url: 'https://buzzheavier.com/gr2fflek1ajb', name: 'Buzzheavier download' },
            ],
            [
                { url: 'https://buzzheavier.com/9dikijlifqqs', name: 'Buzzheavier download' },
            ],
            [
                { url: 'https://buzzheavier.com/o794sgdyy4sd', name: 'Buzzheavier download' },
            ],
            [
                { url: 'https://buzzheavier.com/ky6a2rmnryqr', name: 'Buzzheavier download' },
            ],
            [
                { url: 'https://buzzheavier.com/i4zetxtmtyzx', name: 'Buzzheavier download' },
            ],
],},
    trumanshow: {
        video: [
            'https://rumble.com/embed/v59iui1/?pub=3u4il9'
        ],
        episodeTitles: [
            'Movie'
        ],
        customDownloads: [
            [
                { url: 'https://buzzheavier.com/dwau15erf2oo', name: 'Buzzheavier download' },
                { url: 'https://1fichier.com/?vft29a8aystdbu9bogiz', name: '1ficher download' },
            ],
        ],
    },
    fightclub: {
    video: [
        'https://rumble.com/embed/v59iuxp/?pub=3u4il9'
    ],
    episodeTitles: [
            'Movie'
        ],
    customDownloads: [
    [
{ url: 'https://buzzheavier.com/gt92qzd5y0ot', name: 'Buzzheavier download' },
{ url: 'https://1fichier.com/?o2ip5t3gtrmjlu25oyjo', name: '1ficher download' },
],]},
batmantdk: {
    video: [
        'https://rumble.com/embed/v5eof6l/?pub=3u4il9'
    ],
    episodeTitles: [
            'Movie'
        ],
    customDownloads: [
    [
{ url: 'https://buzzheavier.com/5macsyguydmg', name: 'Buzzheavier download' },
{ url: 'https://1fichier.com/?vbhxxdl947gzz7te2k13', name: '1ficher download' },
],]},
batmantdkr: {
    video: [
        'https://rumble.com/embed/v5vt2et/?pub=3u4il9'
    ],
    episodeTitles: [
            'Movie'
        ],
    customDownloads: [
    [
{ url: 'https://buzzheavier.com/ed65ifnkqjxw', name: 'Buzzheavier download' },
{ url: 'https://1fichier.com/?5te3bbzkt9in8gd5zklw', name: '1ficher download' },
],]},
borat: {
    video: [
        'https://rumble.com/embed/v59rvud/?pub=3u4il9'
    ],
    episodeTitles: [
            'Movie'
        ],
    customDownloads: [
    [
{ url: 'https://buzzheavier.com/xui2k2543nej', name: 'Buzzheavier download' },
{ url: 'https://1fichier.com/?mb332nrv65pwe69y5105', name: '1ficher download' },
],]},
borat2: {
    video: [
        'https://rumble.com/embed/v5f3fxh/?pub=3u4il9'
    ],
    episodeTitles: [
            'Movie'
        ],
    customDownloads: [
    [
{ url: 'https://buzzheavier.com/87rqlgx67msw', name: 'Buzzheavier download' },
{ url: 'https://1fichier.com/?s9nfsdpb2nztwac3jpeq', name: '1ficher download' },
],]},
taken: {
    video: [
        'https://rumble.com/embed/v5b2fc4/?pub=3u4il9'
    ],
    episodeTitles: [
            'Movie'
        ],
    customDownloads: [
    [
{ url: 'https://buzzheavier.com/ipddl4u8vqs0', name: 'Buzzheavier download' },
{ url: 'https://1fichier.com/?2m5jguyyjlern0p935qo', name: '1ficher download' },
],]},
taken2: {
    video: [
        'https://rumble.com/embed/v5b2ixp/?pub=3u4il9'
    ],
    episodeTitles: [
            'Movie'
        ],
    customDownloads: [
    [
{ url: 'https://buzzheavier.com/ngmwn8dz05i8', name: 'Buzzheavier download' },
{ url: 'https://1fichier.com/?6ep1tcxcw84p8zvbfs5m', name: '1ficher download' },
],]},
taken3: {
    video: [
        'https://rumble.com/embed/v5b2os4/?pub=3u4il9'
    ],
    episodeTitles: [
            'Movie'
        ],
    customDownloads: [
    [
{ url: 'https://buzzheavier.com/2hnnwau6orgy', name: 'Buzzheavier download' },
{ url: 'https://1fichier.com/?ldumxojih465jn8dqbpr', name: '1ficher download' },
],]},
deadpool: {
    video: [
        'https://rumble.com/embed/v59nkat/?pub=3u4il9'
    ],
    episodeTitles: [
            'Movie'
        ],
    customDownloads: [
    [
{ url: 'https://buzzheavier.com/73m7rgz5lz0p', name: 'Buzzheavier download' },
{ url: 'https://1fichier.com/?4co5xxjncda1axquedna', name: '1ficher download' },
],]},
deadpool2: {
    video: [
        'https://rumble.com/embed/v6324t7/?pub=3u4il9'
    ],
    episodeTitles: [
            'Movie'
        ],
    customDownloads: [
    [
{ url: 'https://buzzheavier.com/xyh22qne59rm', name: 'Buzzheavier download' },
{ url: 'https://1fichier.com/?23bmke0x0bg7cssv7gl8', name: '1ficher download' },
],]},
deadpool3: {
    video: [
        'https://rumble.com/embed/v5w2is5/?pub=3u4il9'
    ],
    episodeTitles: [
            'Movie'
        ],
    customDownloads: [
    [
{ url: 'https://buzzheavier.com/vs8q9c9tgzj7', name: 'Buzzheavier download' },
{ url: 'https://1fichier.com/?2hwaffdtpqvkztlxqxgj', name: '1ficher download' },
],]},
lorax: {
    video: [
        'https://rumble.com/embed/v5erdoy/?pub=3u4il9'
    ],
    episodeTitles: [
            'Movie'
        ],
    customDownloads: [
    [
{ url: 'https://buzzheavier.com/ykwuhpvqzbnk', name: 'Buzzheavier download' },
{ url: 'https://1fichier.com/?a7qmikqr7vlt7sg9xwaw', name: '1ficher download' },
],]},
transformers12007: {
    video: [
        'https://rumble.com/embed/v5dd0fg/?pub=3u4il9'
    ],
    episodeTitles: [
            'Movie'
        ],
    customDownloads: [
    [
{ url: 'https://buzzheavier.com/85bd1264zhdx', name: 'Buzzheavier download' },
{ url: 'https://1fichier.com/?385cmcxdfwffbfkinsdq', name: '1ficher download' },
],]},
transformers2rotf: {
    video: [
        'https://rumble.com/embed/v5w2ig2/?pub=3u4il9'
    ],
    episodeTitles: [
            'Movie'
        ],
    customDownloads: [
    [
{ url: 'https://buzzheavier.com/y6gyav392wzc', name: 'Buzzheavier download' },
{ url: 'https://1fichier.com/?s12qigt82gedlsbhuog0', name: '1ficher download' },
],]},
whiplash: {
    video: [
        'https://rumble.com/embed/v59ixmq/?pub=3u4il9'
    ],
    episodeTitles: [
            'Movie'
        ],
    customDownloads: [
    [
{ url: 'https://buzzheavier.com/46ni48j2cx2o', name: 'Buzzheavier download' },
{ url: 'https://1fichier.com/?jwcykaat72cu8w8gczxr', name: '1ficher download' },
],]},
homealone: {
    video: [
        'https://rumble.com/embed/v6016wz/?pub=3u4il9'
    ],
    episodeTitles: [
            'Movie'
        ],
    customDownloads: [
    [
{ url: 'https://buzzheavier.com/fqnq80c2asoj', name: 'Buzzheavier download' },
{ url: 'https://1fichier.com/?brr661oaduwgn1i5ek0j', name: '1ficher download' },
],]},
homealone2: {
    video: [
        'https://rumble.com/embed/v6016t8/?pub=3u4il9'
    ],
    episodeTitles: [
            'Movie'
        ],
    customDownloads: [
    [
{ url: 'https://buzzheavier.com/cvf08vxqull2', name: 'Buzzheavier download' },
{ url: 'https://1fichier.com/?ypjpq6tp9n1xge0ygftt', name: '1ficher download' },
],]},
superheromovie: {
    video: [
        'https://rumble.com/embed/v607vxn/?pub=3u4il9'
    ],
    episodeTitles: [
            'Movie'
        ],
    customDownloads: [
    [
{ url: 'https://buzzheavier.com/xz03dwny0iwm', name: 'Buzzheavier download' },
{ url: 'https://1fichier.com/?nnaxeazxs1oxo1inqaqm', name: '1ficher download' },
],]},
tnes: {
    video: [
        'https://rumble.com/embed/v608jp2/?pub=3u4il9',
        'https://rumble.com/embed/v608dl2/?pub=3u4il9'
    ],
    episodeTitles: [
            'Movie HD',
            'Movie Original'
        ],
    customDownloads: [
    [
{ url: 'https://buzzheavier.com/ma1z1657zc3t', name: 'Buzzheavier download' },
{ url: 'none', name: '1ficher download' },
],
[
{ url: 'https://buzzheavier.com/kd25xrr0odit', name: 'Buzzheavier download' },
{ url: 'none', name: '1ficher download' },
],]},




    // SHOWS ADD AFTER THIS

    tourdp: {
    video: [
        'https://rumble.com/embed/v5yexwh/?pub=3u4il9'
    ],
    episodeTitles: [
            'Movie'
        ],
    customDownloads: [
    [
{ url: 'https://buzzheavier.com/rg7d1um9p4pt', name: 'Buzzheavier download' },
{ url: 'https://1fichier.com/?bj6shoo1nyv4wz0j9l2f', name: '1ficher download' },
],]},

    naartgh: {
    video: [
        'https://rumble.com/embed/v5wt2u2/?pub=3u4il9',
        'https://rumble.com/embed/v5wt2wz/?pub=3u4il9',
        'https://rumble.com/embed/v5wt2zw/?pub=3u4il9',
        'https://rumble.com/embed/v5wt338/?pub=3u4il9',
        'https://rumble.com/embed/v5wt35q/?pub=3u4il9',
        'https://rumble.com/embed/v5wt37t/?pub=3u4il9'
    ],
    episodeTitles: [
            '1. Deadmans Gorge',
            '2. Hells Peak',
            '3. Giants Gully',
            '4. Hunters Fury',
            '5. Dark Pines',
            '6. Doom Valley'
        ],
    customDownloads: [
    [
{ url: 'https://buzzheavier.com/h6x2a3qa4kyj', name: 'Buzzheavier download' },
{ url: 'https://1fichier.com/?enu6b5un0rqs4jf5844p', name: '1ficher download' },
],
[
{ url: 'https://buzzheavier.com/h6x2a3qa4kyj', name: 'Buzzheavier download' },
{ url: 'https://1fichier.com/?enu6b5un0rqs4jf5844p', name: '1ficher download' },
],
[
{ url: 'https://buzzheavier.com/h6x2a3qa4kyj', name: 'Buzzheavier download' },
{ url: 'https://1fichier.com/?enu6b5un0rqs4jf5844p', name: '1ficher download' },
],
[
{ url: 'https://buzzheavier.com/h6x2a3qa4kyj', name: 'Buzzheavier download' },
{ url: 'https://1fichier.com/?enu6b5un0rqs4jf5844p', name: '1ficher download' },
],
[
{ url: 'https://buzzheavier.com/h6x2a3qa4kyj', name: 'Buzzheavier download' },
{ url: 'https://1fichier.com/?enu6b5un0rqs4jf5844p', name: '1ficher download' },
],
[
{ url: 'https://buzzheavier.com/h6x2a3qa4kyj', name: 'Buzzheavier download' },
{ url: 'https://1fichier.com/?enu6b5un0rqs4jf5844p', name: '1ficher download' },
],
]
},
    s1tgt: {
    video: [
        'https://rumble.com/embed/v5wppwb/?pub=3u4il9',
        'https://rumble.com/embed/v5wpicn/?pub=3u4il9',
        'https://rumble.com/embed/v5wppp8/?pub=3u4il9',
        'https://rumble.com/embed/v5wpphb/?pub=3u4il9',
        'https://rumble.com/embed/v5wppee/?pub=3u4il9',
        'https://rumble.com/embed/v5wpgvq/?pub=3u4il9',
        'https://rumble.com/embed/v5wpcg5/?pub=3u4il9',
        'https://rumble.com/embed/v5wpu8k/?pub=3u4il9',
        'https://rumble.com/embed/v5wpook/?pub=3u4il9',
        'https://rumble.com/embed/v5wpqf2/?pub=3u4il9',
        'https://rumble.com/embed/v5wplw5/?pub=3u4il9',
        'https://rumble.com/embed/v5wpq7k/?pub=3u4il9',
        'https://rumble.com/embed/v5wpm7e/?pub=3u4il9'
    ],
    episodeTitles: [
            '1. The Holy Trinity',
            '2. Operation Desert Stumble',
            '3. Opera, Arts and Donuts',
            '4. Enviro-mental',
            '5. Moroccan Roll',
            '6. Happy Finnish Christmas',
            '7. The Beach(Buggy)Boys Part 1',
            '8. The Beach(Buggy)Boys Part 2',
            '9. Berks to the Future',
            '10. Dumb Fight at the O.K.Coral',
            '11. Italian Lessons',
            '12. [censored] to [censored]',
            '13. Past v Future'
        ],
    customDownloads: [
    [
{ url: 'https://buzzheavier.com/iadx5j6njbhn', name: 'Buzzheavier download' },
{ url: 'https://1fichier.com/?hdkw2zxi4mz1jpie3uq2', name: '1ficher download' },
],
[
{ url: 'https://buzzheavier.com/sdzd0yghrdi7', name: 'Buzzheavier download' },
{ url: 'https://1fichier.com/?aliyyk64p3o04y9y8o53', name: '1ficher download' },
],
[
{ url: 'https://buzzheavier.com/dde505dld4wu', name: 'Buzzheavier download' },
{ url: 'https://1fichier.com/?dziu08npmqbdqxohf4nl', name: '1ficher download' },
],
[
{ url: 'https://buzzheavier.com/zy4jn8glwn6i', name: 'Buzzheavier download' },
{ url: 'https://1fichier.com/?jc02izlhaw5fpcp66j6q', name: '1ficher download' },
],
[
{ url: 'https://buzzheavier.com/b3f84kbden9o', name: 'Buzzheavier download' },
{ url: 'https://1fichier.com/?a5l3kragjq03ll8tr4b8', name: '1ficher download' },
],
[
{ url: 'https://buzzheavier.com/1piaeinpu467', name: 'Buzzheavier download' },
{ url: 'https://1fichier.com/?enn8j58nnc2bwf5ruz37', name: '1ficher download' },
],
[
{ url: 'https://buzzheavier.com/s06fzs3l88hn', name: 'Buzzheavier download' },
{ url: 'https://1fichier.com/?8k9g2ioaaqlyaihg0czr', name: '1ficher download' },
],
[
{ url: 'https://buzzheavier.com/m5f1t1woey2w', name: 'Buzzheavier download' },
{ url: 'https://1fichier.com/?29hz3yqpa281jdecq7l5', name: '1ficher download' },
],
[
{ url: 'https://buzzheavier.com/14126ejxze2r', name: 'Buzzheavier download' },
{ url: 'https://1fichier.com/?lrmbq1v36sty8wdxuotk', name: '1ficher download' },
],
[
{ url: 'https://buzzheavier.com/q3vp2zrgcm4p', name: 'Buzzheavier download' },
{ url: 'https://1fichier.com/?wztvpidcfly9gadjwv2h', name: '1ficher download' },
],
[
{ url: 'https://buzzheavier.com/jlwkdeiqvwn7', name: 'Buzzheavier download' },
{ url: 'https://1fichier.com/?6beiums51l5nb16vpge1', name: '1ficher download' },
],
[
{ url: 'https://buzzheavier.com/ex95ohf9lp53', name: 'Buzzheavier download' },
{ url: 'https://1fichier.com/?1a2fkx406mp8ph89gavx', name: '1ficher download' },
],
[
{ url: 'https://buzzheavier.com/wvqv0pkkecay', name: 'Buzzheavier download' },
{ url: 'https://1fichier.com/?99jlxrbu4ptzy0z9qcey', name: '1ficher download' },
],
]
},

squidgames1: {
    video: [
        'https://rumble.com/embed/v69425p/?pub=3u4il9',
        'https://rumble.com/embed/v6944ey/?pub=3u4il9',
        'https://rumble.com/embed/v6949gm/?pub=3u4il9',
        'https://rumble.com/embed/v694bym/?pub=3u4il9',
        'https://rumble.com/embed/v694e7v/?pub=3u4il9',
        'https://rumble.com/embed/v694i04/?pub=3u4il9',
        'https://rumble.com/embed/v694krp/?pub=3u4il9',
        'https://rumble.com/embed/v69n0ty/?pub=3u4il9',
        'https://rumble.com/embed/v69n0xa/?pub=3u4il9'
    ],
    episodeTitles: [
            '1. Mugunghwa Kkochi Pideon Nal',
            '2. Jiok',
            '3. Usan-eul Sseun Namja',
            '4. Jollyeodo Pyeonmeokgi',
            '5. Pyeongdeung-han Sesang',
            '6. Kkanbu',
            '7. VIPS',
            '8. Peuronteumaen',
            '9. Unsu Joeun Nal'
        ],
    customDownloads: [
    [
{ url: 'https://buzzheavier.com/60mhkfgfzupx', name: 'Buzzheavier download' },
],
[
{ url: 'https://buzzheavier.com/60mhkfgfzupx', name: 'Buzzheavier download' },
],
[
{ url: 'https://buzzheavier.com/60mhkfgfzupx', name: 'Buzzheavier download' },
],
[
{ url: 'https://buzzheavier.com/60mhkfgfzupx', name: 'Buzzheavier download' },
],
[
{ url: 'https://buzzheavier.com/60mhkfgfzupx', name: 'Buzzheavier download' },
],
[
{ url: 'https://buzzheavier.com/60mhkfgfzupx', name: 'Buzzheavier download' },
],
[
{ url: 'https://buzzheavier.com/60mhkfgfzupx', name: 'Buzzheavier download' },
],
[
{ url: 'https://buzzheavier.com/60mhkfgfzupx', name: 'Buzzheavier download' },
],
[
{ url: 'https://buzzheavier.com/60mhkfgfzupx', name: 'Buzzheavier download' },
],
]
},

s2tgt: {
    video: [
        'https://rumble.com/embed/v5yyfbq/?pub=3u4il9',
        'https://rumble.com/embed/v5yyf4n/?pub=3u4il9',
        'https://rumble.com/embed/v5yyfgb/?pub=3u4il9',
        'https://rumble.com/embed/v5yyfwk/?pub=3u4il9',
        'https://rumble.com/embed/v5yywgt/?pub=3u4il9',
        'https://rumble.com/embed/v5yywnh/?pub=3u4il9',
        'https://rumble.com/embed/v5yywqt/?pub=3u4il9',
        'https://rumble.com/embed/v5yywu5/?pub=3u4il9',
        'https://rumble.com/embed/v5yzcc2/?pub=3u4il9',
        'https://rumble.com/embed/v5yzcue/?pub=3u4il9',
        'https://rumble.com/embed/v5yzcpt/?pub=3u4il9'
    ],
    episodeTitles: [
            '1. Past, Present or Future',
            '2. The Fall Guys',
            '3. Bah humbug-atti',
            '4. Unscripted',
            '5. Up, Down and Round the Farm',
            '6. Jaaaaaaaags',
            '7. Its a gas, gas, gas',
            '8. Blasts from the Past',
            '9. Breaking, Badly',
            '10. Oh, Canada',
            '11. Feed the World'
        ],
    customDownloads: [
    [
{ url: 'https://buzzheavier.com/gb2jr53igpma', name: 'Buzzheavier download' },
{ url: 'https://1fichier.com/?day0zll1sjkhbr5hmbxh', name: '1ficher download' },
],
[
{ url: 'https://buzzheavier.com/gb2jr53igpma', name: 'Buzzheavier download' },
{ url: 'https://1fichier.com/?day0zll1sjkhbr5hmbxh', name: '1ficher download' },
],
[
{ url: 'https://buzzheavier.com/gb2jr53igpma', name: 'Buzzheavier download' },
{ url: 'https://1fichier.com/?day0zll1sjkhbr5hmbxh', name: '1ficher download' },
],
[
{ url: 'https://buzzheavier.com/gb2jr53igpma', name: 'Buzzheavier download' },
{ url: 'https://1fichier.com/?day0zll1sjkhbr5hmbxh', name: '1ficher download' },
],
[
{ url: 'https://buzzheavier.com/gb2jr53igpma', name: 'Buzzheavier download' },
{ url: 'https://1fichier.com/?day0zll1sjkhbr5hmbxh', name: '1ficher download' },
],
[
{ url: 'https://buzzheavier.com/gb2jr53igpma', name: 'Buzzheavier download' },
{ url: 'https://1fichier.com/?day0zll1sjkhbr5hmbxh', name: '1ficher download' },
],
[
{ url: 'https://buzzheavier.com/gb2jr53igpma', name: 'Buzzheavier download' },
{ url: 'https://1fichier.com/?day0zll1sjkhbr5hmbxh', name: '1ficher download' },
],
[
{ url: 'https://buzzheavier.com/u8vw10w1y2w8', name: 'Buzzheavier download' },
{ url: 'https://1fichier.com/?h1tw6ygvu4rea9meuqtt', name: '1ficher download' },
],
[
{ url: 'https://buzzheavier.com/u8vw10w1y2w8', name: 'Buzzheavier download' },
{ url: 'https://1fichier.com/?h1tw6ygvu4rea9meuqtt', name: '1ficher download' },
],
[
{ url: 'https://buzzheavier.com/u8vw10w1y2w8', name: 'Buzzheavier download' },
{ url: 'https://1fichier.com/?h1tw6ygvu4rea9meuqtt', name: '1ficher download' },
],
[
{ url: 'https://buzzheavier.com/u8vw10w1y2w8', name: 'Buzzheavier download' },
{ url: 'https://1fichier.com/?h1tw6ygvu4rea9meuqtt', name: '1ficher download' },
],
]},

s3tgt: {
    video: [
        'https://rumble.com/embed/v6npyu6/?pub=4jqwl4',
        'https://rumble.com/embed/v6npyui/?pub=4jqwl4',
        'https://rumble.com/embed/v6npyuu/?pub=4jqwl4',
        'https://rumble.com/embed/v6npyv6/?pub=4jqwl4',
        'https://rumble.com/embed/v6npzf8/?pub=4jqwl4',
        'https://rumble.com/embed/v6npzfm/?pub=4jqwl4',
        'https://rumble.com/embed/v6npzg2/?pub=4jqwl4',
        'https://rumble.com/embed/v6npzgi/?pub=4jqwl4',
        'https://rumble.com/embed/v6nq0k8/?pub=4jqwl4',
        'https://rumble.com/embed/v6nq0kk/?pub=4jqwl4',
        'https://rumble.com/embed/v6nq0ky/?pub=4jqwl4',
        'https://rumble.com/embed/v6nq0l8/?pub=4jqwl4',
        'https://rumble.com/embed/v6nq16w/?pub=4jqwl4',
        'https://rumble.com/embed/v6nq17a/?pub=4jqwl4'
    ],
    episodeTitles: [
            '1. Motown Funk',
            '2. Colombia Special (1)',
            '3. Colombia Special (2)',
            '4. Pick Up, Put Downs',
            '5. An Itchy Urus',
            '6. Chinese Food for Thought',
            '7. Well Aged Scotch',
            '8. International Buffoons Vacation',
            '9. Aston, Astronauts and Angelinas Children',
            '10. The Youth Vote',
            '11. Sea to Unsalty Sea',
            '12. Legends and Luggage',
            '13. Survival of the Fattest',
            '14. Funeral for a Ford'
        ],
    customDownloads: [
    [
{ url: 'https://buzzheavier.com/e3xul156yv7j', name: 'Buzzheavier download' },
],
[
{ url: 'https://buzzheavier.com/e3xul156yv7j', name: 'Buzzheavier download' },
],
[
{ url: 'https://buzzheavier.com/e3xul156yv7j', name: 'Buzzheavier download' },
],
[
{ url: 'https://buzzheavier.com/e3xul156yv7j', name: 'Buzzheavier download' },
],
[
{ url: 'https://buzzheavier.com/e3xul156yv7j', name: 'Buzzheavier download' },
],
[
{ url: 'https://buzzheavier.com/e3xul156yv7j', name: 'Buzzheavier download' },
],
[
{ url: 'https://buzzheavier.com/e3xul156yv7j', name: 'Buzzheavier download' },
],
[
{ url: 'https://buzzheavier.com/yc5y12cq4uh5', name: 'Buzzheavier download' },
],
[
{ url: 'https://buzzheavier.com/yc5y12cq4uh5', name: 'Buzzheavier download' },
],
[
{ url: 'https://buzzheavier.com/yc5y12cq4uh5', name: 'Buzzheavier download' },
],
[
{ url: 'https://buzzheavier.com/yc5y12cq4uh5', name: 'Buzzheavier download' },
],
[
{ url: 'https://buzzheavier.com/yc5y12cq4uh5', name: 'Buzzheavier download' },
],
[
{ url: 'https://buzzheavier.com/yc5y12cq4uh5', name: 'Buzzheavier download' },
],
[
{ url: 'https://buzzheavier.com/yc5y12cq4uh5', name: 'Buzzheavier download' },
],
]},

sharpe: {
    video: [
        'https://rumble.com/embed/v59hbk3/?pub=3u4il9',
        'https://rumble.com/embed/v59hc1e/?pub=3u4il9',
        'https://rumble.com/embed/v59hcyk/?pub=3u4il9',
        'https://rumble.com/embed/v59hdmt/?pub=3u4il9',
        'https://rumble.com/embed/v59hgnp/?pub=3u4il9',
        'https://rumble.com/embed/v59hnfh/?pub=3u4il9',
        'https://rumble.com/embed/v59ho4d/?pub=3u4il9',
        'https://rumble.com/embed/v59l7p5/?pub=3u4il9',
        'https://rumble.com/embed/v59l7zf/?pub=3u4il9',
        'https://rumble.com/embed/v59l8v9/?pub=3u4il9',
        'https://rumble.com/embed/v59l8x9/?pub=3u4il9',
        'https://rumble.com/embed/v59l93x/?pub=3u4il9',
        'https://rumble.com/embed/v59l96x/?pub=3u4il9',
        'https://rumble.com/embed/v59l9k9/?pub=3u4il9',
        'https://rumble.com/embed/v59hb3h/?pub=3u4il9',
        'https://rumble.com/embed/v59l9no/?pub=3u4il9',
        'https://rumble.com/embed/v59l9rv/?pub=3u4il9',
        'https://rumble.com/embed/v59l9tx/?pub=3u4il9',
        'https://rumble.com/embed/v59la4l/?pub=3u4il9'
    ],
    episodeTitles: [
            '1. Sharpes Rifles',
            '2. Sharpes Eagle',
            '3. Sharpes Company',
            '4. Sharpes Enemy',
            '5. Sharpes Honour',
            '6. Sharpes Gold',
            '7. Sharpes Battle',
            '8. Sharpes Sword',
            '9. Sharpes Regiment',
            '10. Sharpes Siege',
            '11. Sharpes Mission',
            '12. Sharpes Revenge',
            '13. Sharpes Justice',
            '14. Sharpes Waterloo',
            '15. Sharpes Legend',
            '16. Sharpes Challenge',
            '17. Sharpes Challenge: Part 2',
            '18. Sharpes Peril',
            '19. Sharpes Peril: Part 2'

        ],
    customDownloads: [
        [
            { url: 'https://buzzheavier.com/5ygv6xj77uvx', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/5ygv6xj77uvx', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/5ygv6xj77uvx', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/5ygv6xj77uvx', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/5ygv6xj77uvx', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/5ygv6xj77uvx', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/5ygv6xj77uvx', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/5ygv6xj77uvx', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/5ygv6xj77uvx', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/5ygv6xj77uvx', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/5ygv6xj77uvx', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/5ygv6xj77uvx', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/5ygv6xj77uvx', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/5ygv6xj77uvx', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/5ygv6xj77uvx', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/5ygv6xj77uvx', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/5ygv6xj77uvx', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/5ygv6xj77uvx', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/5ygv6xj77uvx', name: 'Buzzheavier download' },
        ],
]},

invincibles1: {
    video: [
        'https://rumble.com/embed/v6j85ty/?pub=4jqwl4',
        'https://rumble.com/embed/v6j85yy/?pub=4jqwl4',
        'https://rumble.com/embed/v6j863j/?pub=4jqwl4',
        'https://rumble.com/embed/v6j867p/?pub=4jqwl4',
        'https://rumble.com/embed/v6jcftp/?pub=4jqwl4',
        'https://rumble.com/embed/v6jcfya/?pub=4jqwl4',
        'https://rumble.com/embed/v6jcg2v/?pub=4jqwl4',
        'https://rumble.com/embed/v6jcg5d/?pub=4jqwl4'
    ],
    episodeTitles: [
            '1. Its About Time',
            '2. Here Goes Nothing',
            '3. Who You Calling Ugly?',
            '4. Neil Armstrong, Eat Your Heart Out',
            '5. That Actually Hurt',
            '6. You Look Kinda Dead',
            '7. We Need to Talk',
            '8. Where I Really Come From'
        ],
    customDownloads: [
        [
            { url: 'https://buzzheavier.com/t7v78dosfq9u', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/t7v78dosfq9u', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/t7v78dosfq9u', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/t7v78dosfq9u', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/t7v78dosfq9u', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/t7v78dosfq9u', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/t7v78dosfq9u', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/t7v78dosfq9u', name: 'Buzzheavier download' },
        ],
]},

invincibles2: {
    video: [
        'https://rumble.com/embed/v6jdhug/?pub=4jqwl4',
        'https://rumble.com/embed/v6jdi14/?pub=4jqwl4',
        'https://rumble.com/embed/v6jdi5a/?pub=4jqwl4',
        'https://rumble.com/embed/v6jdi9v/?pub=4jqwl4',
        'https://rumble.com/embed/v6jdtrm/?pub=4jqwl4',
        'https://rumble.com/embed/v6jdtya/?pub=4jqwl4',
        'https://rumble.com/embed/v6jdufs/?pub=4jqwl4',
        'https://rumble.com/embed/v6jdujy/?pub=4jqwl4'
    ],
    episodeTitles: [
            '1. A Lesson for Your Next Life',
            '2. In About Six Hours I Lose My Virginity to a Fish',
            '3. This Missive, This Machination!',
            '4. Its Been a While',
            '5. This Must Come as a Shock',
            '6. Its Not That Simple',
            '7. Im Not Going Anywhere',
            '8. I Thought You Were Stronger'
        ],
    customDownloads: [
]},

invincibles3: {
    video: [
        'https://rumble.com/embed/v6j7utp/?pub=4jqwl4',
        'https://rumble.com/embed/v6j7uu4/?pub=4jqwl4',
        'https://rumble.com/embed/v6j7uxg/?pub=4jqwl4',
        'https://rumble.com/embed/v6j7v0s/?pub=4jqwl4'
    ],
    episodeTitles: [
            '1. Youre Not Laughing Now',
            '2. A Deal with the Devil',
            '3. You Want a Real Costume, Right?',
            '4. You Were My Hero'
        ],
    customDownloads: [
]},


    // ANIME ADD AFTER THIS



misskuroitsu: {
    video: [
        'https://rumble.com/embed/v5vs5me/?pub=3u4il9',
                'https://rumble.com/embed/v6asngd/?pub=3u4il9',
        'https://rumble.com/embed/v5vs5o2/?pub=3u4il9',
                'https://rumble.com/embed/v6asniv/?pub=3u4il9',
        'https://rumble.com/embed/v5vs5re/?pub=3u4il9',
                'https://rumble.com/embed/v6asnop/?pub=3u4il9',
        'https://rumble.com/embed/v5vs5wt/?pub=3u4il9',
                'https://rumble.com/embed/v6asnsv/?pub=3u4il9',
        'https://rumble.com/embed/v5vs5y2/?pub=3u4il9',
                'https://rumble.com/embed/v6asrt1/?pub=3u4il9',
        'https://rumble.com/embed/v5vs5zq/?pub=3u4il9',
                'https://rumble.com/embed/v6asrzp/?pub=3u4il9',
        'https://rumble.com/embed/v5vs64q/?pub=3u4il9',
                'https://rumble.com/embed/v6ass4p/?pub=3u4il9',
        'https://rumble.com/embed/v5vs68w/?pub=3u4il9',
                'https://rumble.com/embed/v6assay/?pub=3u4il9',
        'https://rumble.com/embed/v5vs6a5/?pub=3u4il9',
                'https://rumble.com/embed/v6aswcs/?pub=3u4il9',
        'https://rumble.com/embed/v5vs6cn/?pub=3u4il9',
                'https://rumble.com/embed/v6aswl4/?pub=3u4il9',
        'https://rumble.com/embed/v5vs6fk/?pub=3u4il9',
                'https://rumble.com/embed/v6aswpp/?pub=3u4il9',
        'https://rumble.com/embed/v5vs6hn/?pub=3u4il9',
                'https://rumble.com/embed/v6aswrs/?pub=3u4il9'
    ],
    episodeTitles: [
            '1. She Cried Inside',
            'JP 1. She Cried Inside',
            '2. The Legendary Emissary',
            'JP 2. The Legendary Emissary',
            '3. The Monster in',
            'JP 3. The Monster in',
            '4. The Soul of a Demon',
            'JP 4. The Soul of a Demon',
            '5. Saved by a Smile',
            'JP 5. Saved by a Smile',
            '6. An Unsophisticated Soul',
            'JP 6. An Unsophisticated Soul',
            '7. The Result of Passions',
            'JP 7. The Result of Passions',
            '8. The Sheer Malevolence',
            'JP 8. The Sheer Malevolence',
            '9. The Rotting but Heroic Figures',
            'JP 9. The Rotting but Heroic Figures',
            '10. The Very Concept of the Evil',
            'JP 10. The Very Concept of the Evil',
            '11. The Sacrifice',
            'JP 11. The Sacrifice',
            '12. Those Sacrifices Saved from Hell',
            'JP 12. Those Sacrifices Saved from Hell'
        ],
    customDownloads: [
        [
            { url: 'https://buzzheavier.com/i92cs8qvn0ry', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/i92cs8qvn0ry', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/i92cs8qvn0ry', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/i92cs8qvn0ry', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/i92cs8qvn0ry', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/i92cs8qvn0ry', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/i92cs8qvn0ry', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/i92cs8qvn0ry', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/i92cs8qvn0ry', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/i92cs8qvn0ry', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/i92cs8qvn0ry', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/i92cs8qvn0ry', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/i92cs8qvn0ry', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/i92cs8qvn0ry', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/i92cs8qvn0ry', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/i92cs8qvn0ry', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/i92cs8qvn0ry', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/i92cs8qvn0ry', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/i92cs8qvn0ry', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/i92cs8qvn0ry', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/i92cs8qvn0ry', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/i92cs8qvn0ry', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/i92cs8qvn0ry', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/i92cs8qvn0ry', name: 'Buzzheavier download' },
        ],
    ]
},

isekaiquartets1: {
    video: [
        'https://rumble.com/embed/v6ag92s/?pub=3u4il9',
        'https://rumble.com/embed/v6at1za/?pub=3u4il9',
        'https://rumble.com/embed/v6ag95p/?pub=3u4il9',
        'https://rumble.com/embed/v6at24a/?pub=3u4il9',
        'https://rumble.com/embed/v6ag9aa/?pub=3u4il9',
        'https://rumble.com/embed/v6at281/?pub=3u4il9',
        'https://rumble.com/embed/v6ag9ka/?pub=3u4il9',
        'https://rumble.com/embed/v6at2bs/?pub=3u4il9',
        'https://rumble.com/embed/v6ag9qy/?pub=3u4il9',
        'https://rumble.com/embed/v6at61j/?pub=3u4il9',
        'https://rumble.com/embed/v6ag9vj/?pub=3u4il9',
        'https://rumble.com/embed/v6at66y/?pub=3u4il9',
        'https://rumble.com/embed/v6agfrm/?pub=3u4il9',
        'https://rumble.com/embed/v6at69v/?pub=3u4il9',
        'https://rumble.com/embed/v6agdbp/?pub=3u4il9',
        'https://rumble.com/embed/v6at6d7/?pub=3u4il9',
        'https://rumble.com/embed/v6agdsd/?pub=3u4il9',
        'https://rumble.com/embed/v6atacy/?pub=3u4il9',
        'https://rumble.com/embed/v6agecd/?pub=3u4il9',
        'https://rumble.com/embed/v6atafg/?pub=3u4il9',
        'https://rumble.com/embed/v6ageog/?pub=3u4il9',
        'https://rumble.com/embed/v6atah4/?pub=3u4il9',
        'https://rumble.com/embed/v6agfwm/?pub=3u4il9',
        'https://rumble.com/embed/v6atakv/?pub=3u4il9'
    ],
    episodeTitles: [
            '1. Come Together! Quartet',
            'JP 1. Come Together! Quartet',
            '2. Tension! Introductions',
            'JP 2. Tension! Introductions',
            '3. Deadlock! Classmates',
            'JP 3. Deadlock! Classmates',
            '4. Encounter! Classmates',
            'JP 4. Encounter! Classmates',
            '5. Explosion! Talent Show',
            'JP 5. Explosion! Talent Show',
            '6. Decision! Class Rep',
            'JP 6. Decision! Class Rep',
            '7. Carry Out! Class Rep',
            'JP 7. Carry Out! Class Rep',
            '8. Prepare! Field Trip',
            'JP 8. Prepare! Field Trip',
            '9. Enjoy! Field Trip',
            'JP 9. Enjoy! Field Trip',
            '10. Join In! Rivals',
            'JP 10. Join In! Rivals',
            '11. Work Together! Field Day',
            'JP 11. Work Together! Field Day',
            '12. Band Together! Quartet',
            'JP 12. Band Together! Quartet'
        ],
    customDownloads: [
        [
            { url: 'https://buzzheavier.com/jkdbm7gk3mcg', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/jkdbm7gk3mcg', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/jkdbm7gk3mcg', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/jkdbm7gk3mcg', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/jkdbm7gk3mcg', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/jkdbm7gk3mcg', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/jkdbm7gk3mcg', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/jkdbm7gk3mcg', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/jkdbm7gk3mcg', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/jkdbm7gk3mcg', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/jkdbm7gk3mcg', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/jkdbm7gk3mcg', name: 'Buzzheavier download' },
        ],
        [
            { url: 'https://buzzheavier.com/jkdbm7gk3mcg', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/jkdbm7gk3mcg', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/jkdbm7gk3mcg', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/jkdbm7gk3mcg', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/jkdbm7gk3mcg', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/jkdbm7gk3mcg', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/jkdbm7gk3mcg', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/jkdbm7gk3mcg', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/jkdbm7gk3mcg', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/jkdbm7gk3mcg', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/jkdbm7gk3mcg', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/jkdbm7gk3mcg', name: 'Buzzheavier download' },
        ],
    ]
},
isekaiquartets2: {
    video: [
        'https://rumble.com/embed/v6agmes/?pub=3u4il9',
        'https://rumble.com/embed/v6b3h6s/?pub=3u4il9',
        'https://rumble.com/embed/v6agmxy/?pub=3u4il9',
        'https://rumble.com/embed/v6b3htp/?pub=3u4il9',
        'https://rumble.com/embed/v6agn97/?pub=3u4il9',
        'https://rumble.com/embed/v6b3hzy/?pub=3u4il9',
        'https://rumble.com/embed/v6agnhj/?pub=3u4il9',
        'https://rumble.com/embed/v6b3i5s/?pub=3u4il9',
        'https://rumble.com/embed/v6agps1/?pub=3u4il9',
        'https://rumble.com/embed/v6b3ic1/?pub=3u4il9',
        'https://rumble.com/embed/v6agq21/?pub=3u4il9',
        'https://rumble.com/embed/v6b3k2y/?pub=3u4il9',
        'https://rumble.com/embed/v6agq94/?pub=3u4il9',
        'https://rumble.com/embed/v6b3k8s/?pub=3u4il9',
        'https://rumble.com/embed/v6agqh1/?pub=3u4il9',
        'https://rumble.com/embed/v6b3kga/?pub=3u4il9',
        'https://rumble.com/embed/v6alyza/?pub=3u4il9',
        'https://rumble.com/embed/v6b3kmj/?pub=3u4il9',
        'https://rumble.com/embed/v6alzc7/?pub=3u4il9',
        'https://rumble.com/embed/v6b3lb4/?pub=3u4il9',
        'https://rumble.com/embed/v6alzea/?pub=3u4il9',
        'https://rumble.com/embed/v6b3le1/?pub=3u4il9',
        'https://rumble.com/embed/v6alzgs/?pub=3u4il9',
        'https://rumble.com/embed/v6b3ljg/?pub=3u4il9'
    ],
    episodeTitles: [
            '1. Join the Fight! Transfer Student',
            'JP 1. Join the Fight! Transfer Student',
            '2. Sneak In! The Principals Office',
            'JP 2. Sneak In! The Principals Office',
            '3. Uh-Oh! Detention!',
            'JP 3. Uh-Oh! Detention!',
            '4. Pinch! Test of Learning',
            'JP 4. Pinch! Test of Learning',
            '5. Work Hard! Valentines Day',
            'JP 5. Work Hard! Valentines Day',
            '6. Clash! Dodgeball',
            'JP 6. Clash! Dodgeball',
            '7. Excitement! Physicals Day',
            'JP 7. Excitement! Physicals Day',
            '8. Challenge! Part-Time Job',
            'JP 8. Challenge! Part-Time Job',
            '9. Investigate! First Errand',
            'JP 9. Investigate! First Errand',
            '10. Rise Up! School Festival',
            'JP 10. Rise Up! School Festival',
            '11. It Begins! School Festival',
            'JP 11. It Begins! School Festival',
            '12. The Show Begins! Showtime',
            'JP 12. The Show Begins! Showtime'
        ],
    customDownloads: [
        [
            { url: 'https://buzzheavier.com/kf1c0vaosdpi', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/kf1c0vaosdpi', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/kf1c0vaosdpi', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/kf1c0vaosdpi', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/kf1c0vaosdpi', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/kf1c0vaosdpi', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/kf1c0vaosdpi', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/kf1c0vaosdpi', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/kf1c0vaosdpi', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/kf1c0vaosdpi', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/kf1c0vaosdpi', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/kf1c0vaosdpi', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/kf1c0vaosdpi', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/kf1c0vaosdpi', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/kf1c0vaosdpi', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/kf1c0vaosdpi', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/kf1c0vaosdpi', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/kf1c0vaosdpi', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/kf1c0vaosdpi', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/kf1c0vaosdpi', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/kf1c0vaosdpi', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/kf1c0vaosdpi', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/kf1c0vaosdpi', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/kf1c0vaosdpi', name: 'Buzzheavier download' },
        ],
    ]
},
isekaiquartetanotherworld: {
    video: [
        'https://rumble.com/embed/v6b4gld/?pub=3u4il9'
    ],
    episodeTitles: [
            'Movie'
        ],
    customDownloads: [
    [
{ url: 'https://buzzheavier.com/g2a2kjb0mi63', name: 'Buzzheavier download' },
],]},
disillusionedawstws1: {
    video: [
        'https://rumble.com/embed/v6hubes/?pub=3u4il9',
        'https://rumble.com/embed/v6i966v/?pub=3u4il9',
        'https://rumble.com/embed/v6hubjs/?pub=3u4il9',
        'https://rumble.com/embed/v6i96cp/?pub=3u4il9',
        'https://rumble.com/embed/v6hubod/?pub=3u4il9',
        'https://rumble.com/embed/v6i96hp/?pub=3u4il9',
        'https://rumble.com/embed/v6hubrp/?pub=3u4il9',
        'https://rumble.com/embed/v6i96ma/?pub=3u4il9',
        'https://rumble.com/embed/v6huoa4/?pub=3u4il9',
        'https://rumble.com/embed/v6i9c3d/?pub=3u4il9',
        'https://rumble.com/embed/v6huo0y/?pub=3u4il9',
        'https://rumble.com/embed/v6i9c4m/?pub=3u4il9',
        'https://rumble.com/embed/v6huobs/?pub=3u4il9',
        'https://rumble.com/embed/v6i9c9m/?pub=3u4il9',
        'https://rumble.com/embed/v6huogd/?pub=3u4il9',
        'https://rumble.com/embed/v6i9cdd/?pub=3u4il9',
        'https://rumble.com/embed/v6hv11p/?pub=3u4il9',
        'https://rumble.com/embed/v6i9g4d/?pub=3u4il9',
        'https://rumble.com/embed/v6hv12j/?pub=3u4il9',
        'https://rumble.com/embed/v6i9g8j/?pub=3u4il9',
        'https://rumble.com/embed/v6hv15v/?pub=3u4il9',
        'https://rumble.com/embed/v6i9gbv/?pub=3u4il9',
        'https://rumble.com/embed/v6hv19m/?pub=3u4il9',
        'https://rumble.com/embed/v6i9gf7/?pub=3u4il9'
    ],
    episodeTitles: [
            '1. Disillusioned Adventurers',
            'JP 1. Disillusioned Adventurers',
            '2. The Ultimate Party Is Formed? Survivors!',
            'JP 2. The Ultimate Party Is Formed? Survivors!',
            '3. Currans Secret',
            'JP 3. Currans Secret',
            '4. The Labyrinth of Bonds',
            'JP 4. The Labyrinth of Bonds',
            '5. A Meeting with the Iron Tigers',
            'JP 5. A Meeting with the Iron Tigers',
            '6. Mathematics Bare Knuckle',
            'JP 6. Mathematics Bare Knuckle',
            '7. Gambling Lesson',
            'JP 7. Gambling Lesson',
            '8. The Beautiful Paladin',
            'JP 8. The Beautiful Paladin',
            '9. Legend of the Labyrinth City Stepping Man?!',
            'JP 9. Legend of the Labyrinth City Stepping Man?!',
            '10. Labyrinth Dragnet',
            'JP 10. Labyrinth Dragnet',
            '11. Survivors VS Stepping Man',
            'JP 11. Survivors VS Stepping Man',
            '12. Adventurers Cant Save the World Yet',
            'JP 12. Adventurers Cant Save the World Yet'
        ],
    customDownloads: [
        [
            { url: 'https://buzzheavier.com/6hc88c2tkg1y', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/6hc88c2tkg1y', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/6hc88c2tkg1y', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/6hc88c2tkg1y', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/6hc88c2tkg1y', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/6hc88c2tkg1y', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/6hc88c2tkg1y', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/6hc88c2tkg1y', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/6hc88c2tkg1y', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/6hc88c2tkg1y', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/6hc88c2tkg1y', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/6hc88c2tkg1y', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/6hc88c2tkg1y', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/6hc88c2tkg1y', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/6hc88c2tkg1y', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/6hc88c2tkg1y', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/6hc88c2tkg1y', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/6hc88c2tkg1y', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/6hc88c2tkg1y', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/6hc88c2tkg1y', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/6hc88c2tkg1y', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/6hc88c2tkg1y', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/6hc88c2tkg1y', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/6hc88c2tkg1y', name: 'Buzzheavier download' },
        ],
    ]
},

konosubaloc: {
    video: [
        'https://rumble.com/embed/v6kj9uu/?pub=4jqwl4'
    ],
    episodeTitles: [
        'Movie'
    ],
    customDownloads: [
        [
            { url: 'https://buzzheavier.com/lgxiq6ib55an', name: 'Buzzheavier download' },
        ],],},

konosuba1: {
    video: [
        'https://rumble.com/embed/v6jcnis/?pub=4jqwl4',
        'https://rumble.com/embed/v6jd4p4/?pub=4jqwl4',
        'https://rumble.com/embed/v6jcnns/?pub=4jqwl4',
        'https://rumble.com/embed/v6jd4vs/?pub=4jqwl4',
        'https://rumble.com/embed/v6jcnss/?pub=4jqwl4',
        'https://rumble.com/embed/v6jd4zj/?pub=4jqwl4',
        'https://rumble.com/embed/v6jcnva/?pub=4jqwl4',
        'https://rumble.com/embed/v6jd544/?pub=4jqwl4',
        'https://rumble.com/embed/v6jcti7/?pub=4jqwl4',
        'https://rumble.com/embed/v6jd904/?pub=4jqwl4',
        'https://rumble.com/embed/v6jctn7/?pub=4jqwl4',
        'https://rumble.com/embed/v6jd92m/?pub=4jqwl4',
        'https://rumble.com/embed/v6jctvy/?pub=4jqwl4',
        'https://rumble.com/embed/v6jd96d/?pub=4jqwl4',
        'https://rumble.com/embed/v6jcu0j/?pub=4jqwl4',
        'https://rumble.com/embed/v6jd9bs/?pub=4jqwl4',
        'https://rumble.com/embed/v6jcw9d/?pub=4jqwl4',
        'https://rumble.com/embed/v6jdd7d/?pub=4jqwl4',
        'https://rumble.com/embed/v6jcwcp/?pub=4jqwl4',
        'https://rumble.com/embed/v6jdd9g/?pub=4jqwl4',
        'https://rumble.com/embed/v6jcwiy/?pub=4jqwl4',
        'https://rumble.com/embed/v6jddap/?pub=4jqwl4'
    ],
    episodeTitles: [
            '1. This mysterious monster is defeated by the Isekai Tenshou!',
            'JP 1. This mysterious monster is defeated by the Isekai Tenshou!',
            '2. This is the end of the world!',
            'JP 2. This is the end of the world!',
            '3. Im in the pants!',
            'JP 3. Im in the pants!',
            '4. The Demon of Bakuretsu in This City!',
            'JP 4. The Demon of Bakuretsu in This City!',
            '5. One day at a time!',
            'JP 5. One day at a time!',
            '6. Lets fight together!',
            'JP 6. Lets fight together!',
            '7. The Lords Will and the Lords Will!',
            'JP 7. The Lords Will and the Lords Will!',
            '8. Im sorry for the inconvenience!',
            'JP 8. Im sorry for the inconvenience!',
            '9. A blessing in disguise!',
            'JP 9. A blessing in disguise!',
            '10. Lets celebrate this great day!',
            'JP 10. Lets celebrate this great day!',
            '11. OVA Gods Blessing on This Wonderful Choker!',
            'JP 11. OVA Gods Blessing on This Wonderful Choker!'
        ],
    customDownloads: [
        [
            { url: 'https://buzzheavier.com/95a3podogu5r', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/95a3podogu5r', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/95a3podogu5r', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/95a3podogu5r', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/95a3podogu5r', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/95a3podogu5r', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/95a3podogu5r', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/95a3podogu5r', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/95a3podogu5r', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/95a3podogu5r', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/95a3podogu5r', name: 'Buzzheavier download' },
        ],         [
            { url: 'https://buzzheavier.com/95a3podogu5r', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/95a3podogu5r', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/95a3podogu5r', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/95a3podogu5r', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/95a3podogu5r', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/95a3podogu5r', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/95a3podogu5r', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/95a3podogu5r', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/95a3podogu5r', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/95a3podogu5r', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/95a3podogu5r', name: 'Buzzheavier download' },
        ],
    ]
},

konosubaeotww: {
    video: [
        'https://rumble.com/embed/v6lhwp3/?pub=4jqwl4',
        'https://rumble.com/embed/v6li8l0/?pub=4jqwl4',
        'https://rumble.com/embed/v6lhwqc/?pub=4jqwl4',
        'https://rumble.com/embed/v6li950/?pub=4jqwl4',
        'https://rumble.com/embed/v6lhwsf/?pub=4jqwl4',
        'https://rumble.com/embed/v6li9bo/?pub=4jqwl4',
        'https://rumble.com/embed/v6lhwux/?pub=4jqwl4',
        'https://rumble.com/embed/v6li9ir/?pub=4jqwl4',
        'https://rumble.com/embed/v6lhzr3/?pub=4jqwl4',
        'https://rumble.com/embed/v6licm0/?pub=4jqwl4',
        'https://rumble.com/embed/v6lhztl/?pub=4jqwl4',
        'https://rumble.com/embed/v6lics9/?pub=4jqwl4',
        'https://rumble.com/embed/v6lhzuu/?pub=4jqwl4',
        'https://rumble.com/embed/v6licyi/?pub=4jqwl4',
        'https://rumble.com/embed/v6lhzxr/?pub=4jqwl4',
        'https://rumble.com/embed/v6lid4c/?pub=4jqwl4',
        'https://rumble.com/embed/v6li4pu/?pub=4jqwl4',
        'https://rumble.com/embed/v6lidkl/?pub=4jqwl4',
        'https://rumble.com/embed/v6li4sr/?pub=4jqwl4',
        'https://rumble.com/embed/v6lie0f/?pub=4jqwl4',
        'https://rumble.com/embed/v6li4xr/?pub=4jqwl4',
        'https://rumble.com/embed/v6lie6o/?pub=4jqwl4',
        'https://rumble.com/embed/v6li52c/?pub=4jqwl4',
        'https://rumble.com/embed/v6lie9l/?pub=4jqwl4'
    ],
    episodeTitles: [
            '1. The Crimson-Eyed Wizards',
            'JP 1. The Crimson-Eyed Wizards',
            '2. The Magic Academys Taboo',
            'JP 2. The Magic Academys Taboo',
            '3. Guardians of the Crimson Demon Village',
            'JP 3. Guardians of the Crimson Demon Village',
            '4. The Crimson-Eyed Lonely Master',
            'JP 4. The Crimson-Eyed Lonely Master',
            '5. Prelude to an Explosion of Madness',
            'JP 5. Prelude to an Explosion of Madness',
            '6. The Raison Dêtre of an Explosive NEET',
            'JP 6. The Raison Dêtre of an Explosive NEET',
            '7. Troublemakers of the City of Water',
            'JP 7. Troublemakers of the City of Water',
            '8. Fanatics of the Water City',
            'JP 8. Fanatics of the Water City',
            '9. Destroyer from the Crimson Demon Village',
            'JP 9. Destroyer from the Crimson Demon Village',
            '10. Outlaws of the Town for Beginners',
            'JP 10. Outlaws of the Town for Beginners',
            '11. The Explosion Girl and the Forest Irregularity',
            'JP 11. The Explosion Girl and the Forest Irregularity',
            '12. An Explosion on This Wonderful World!',
            'JP 12. An Explosion on This Wonderful World!'
        ],
    customDownloads: [
        [
            { url: 'https://buzzheavier.com/esybba3dqlsx', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/esybba3dqlsx', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/esybba3dqlsx', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/esybba3dqlsx', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/esybba3dqlsx', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/esybba3dqlsx', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/esybba3dqlsx', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/esybba3dqlsx', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/esybba3dqlsx', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/esybba3dqlsx', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/esybba3dqlsx', name: 'Buzzheavier download' },
        ],         [
            { url: 'https://buzzheavier.com/esybba3dqlsx', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/esybba3dqlsx', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/esybba3dqlsx', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/esybba3dqlsx', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/esybba3dqlsx', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/esybba3dqlsx', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/esybba3dqlsx', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/esybba3dqlsx', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/esybba3dqlsx', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/esybba3dqlsx', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/esybba3dqlsx', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/esybba3dqlsx', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/esybba3dqlsx', name: 'Buzzheavier download' },
        ],
    ]
},

konosuba2: {
    video: [
        'https://rumble.com/embed/v6k73lr/?pub=4jqwl4',
        'https://rumble.com/embed/v6k7bol/?pub=4jqwl4',
        'https://rumble.com/embed/v6k73oo/?pub=4jqwl4',
        'https://rumble.com/embed/v6k7btl/?pub=4jqwl4',
        'https://rumble.com/embed/v6k747f/?pub=4jqwl4',
        'https://rumble.com/embed/v6k7bwx/?pub=4jqwl4',
        'https://rumble.com/embed/v6k74ar/?pub=4jqwl4',
        'https://rumble.com/embed/v6k7c0o/?pub=4jqwl4',
        'https://rumble.com/embed/v6k75c9/?pub=4jqwl4',
        'https://rumble.com/embed/v6k7ngc/?pub=4jqwl4',
        'https://rumble.com/embed/v6k75ec/?pub=4jqwl4',
        'https://rumble.com/embed/v6k7nif/?pub=4jqwl4',
        'https://rumble.com/embed/v6k75ii/?pub=4jqwl4',
        'https://rumble.com/embed/v6k7niu/?pub=4jqwl4',
        'https://rumble.com/embed/v6k75lf/?pub=4jqwl4',
        'https://rumble.com/embed/v6k7nlc/?pub=4jqwl4',
        'https://rumble.com/embed/v6k76rx/?pub=4jqwl4',
        'https://rumble.com/embed/v6k7p1u/?pub=4jqwl4',
        'https://rumble.com/embed/v6k76wi/?pub=4jqwl4',
        'https://rumble.com/embed/v6k7p5l/?pub=4jqwl4',
        'https://rumble.com/embed/v6k76z0/?pub=4jqwl4',
        'https://rumble.com/embed/v6k7p83/?pub=4jqwl4'
    ],
    episodeTitles: [
            '1. Give Me Deliverance from This Judicial Injustice!',
            'JP 1. Give Me Deliverance from This Judicial Injustice!',
            '2. A Friend for This Crimson Demon Girl!',
            'JP 2. A Friend for This Crimson Demon Girl!',
            '3. Peace for the Master of This Labyrinth!',
            'JP 3. Peace for the Master of This Labyrinth!',
            '4. A Betrothed for This Noble Daughter!',
            'JP 4. A Betrothed for This Noble Daughter!',
            '5. Servitude for This Masked Knight!',
            'JP 5. Servitude for This Masked Knight!',
            '6. Goodbye to This Irritating Living World!',
            'JP 6. Goodbye to This Irritating Living World!',
            '7. An Invitation for This Knucklehead!',
            'JP 7. An Invitation for This Knucklehead!',
            '8. Sightseeing in This Pitiful City!',
            'JP 8. Sightseeing in This Pitiful City!',
            '9. A Goddess for This Corrupt Hot Springs Town!',
            'JP 9. A Goddess for This Corrupt Hot Springs Town!',
            '10. Gods Blessings on This Wonderful Party!',
            'JP 10. Gods Blessings on This Wonderful Party!',
            '11. OVA: Gods Blessings on This Wonderful Piece of Art!',
            'JP 11. OVA: Gods Blessings on This Wonderful Piece of Art!'
        ],
    customDownloads: [
        [
            { url: 'https://buzzheavier.com/b1w8nszibrbt', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/b1w8nszibrbt', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/b1w8nszibrbt', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/b1w8nszibrbt', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/b1w8nszibrbt', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/b1w8nszibrbt', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/b1w8nszibrbt', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/b1w8nszibrbt', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/b1w8nszibrbt', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/b1w8nszibrbt', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/b1w8nszibrbt', name: 'Buzzheavier download' },
        ],         [
            { url: 'https://buzzheavier.com/b1w8nszibrbt', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/b1w8nszibrbt', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/b1w8nszibrbt', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/b1w8nszibrbt', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/b1w8nszibrbt', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/b1w8nszibrbt', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/b1w8nszibrbt', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/b1w8nszibrbt', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/b1w8nszibrbt', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/b1w8nszibrbt', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/b1w8nszibrbt', name: 'Buzzheavier download' },
        ],
    ]
},

konosuba3: {
    video: [
        'https://rumble.com/embed/v6m8ayo/?pub=4jqwl4',
        'https://rumble.com/embed/v6m8azx/?pub=4jqwl4',
        'https://rumble.com/embed/v6m8b2u/?pub=4jqwl4',
        'https://rumble.com/embed/v6m8b4x/?pub=4jqwl4',
        'https://rumble.com/embed/v6m8d7x/?pub=4jqwl4',
        'https://rumble.com/embed/v6m8da0/?pub=4jqwl4',
        'https://rumble.com/embed/v6m8dau/?pub=4jqwl4',
        'https://rumble.com/embed/v6m8dff/?pub=4jqwl4',
        'https://rumble.com/embed/v6m8g7f/?pub=4jqwl4',
        'https://rumble.com/embed/v6m8g9x/?pub=4jqwl4',
        'https://rumble.com/embed/v6m8gbl/?pub=4jqwl4'
    ],
    episodeTitles: [
            'JP 1. Gods Blessings on This Bright Future!',
            'JP 2. A Smile for This Dour Girl!',
            'JP 3. A Re-education for This Bright Little Girl!',
            'JP 4. Divine Punishment for This Handsome Gentleman Thief!',
            'JP 5. Nefarious Friends for This Sheltered Princess!',
            'JP 6. A Farewell to This Lavish Lifestyle!',
            'JP 7. Rest for This Up-and-Coming Adventurer!',
            'JP 8. An Eternal Rest for the Master of This Lake!',
            'JP 9. A Talking-To for This Runaway!',
            'JP 10. Blessings for This Selfish Bride!',
            'JP 11. Gods Blessings for These Unchanging Days!'
        ],
    customDownloads: [
        [
            { url: 'https://buzzheavier.com/9ps3cat1r7a9', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/9ps3cat1r7a9', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/9ps3cat1r7a9', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/9ps3cat1r7a9', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/9ps3cat1r7a9', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/9ps3cat1r7a9', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/9ps3cat1r7a9', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/9ps3cat1r7a9', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/9ps3cat1r7a9', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/9ps3cat1r7a9', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/9ps3cat1r7a9', name: 'Buzzheavier download' },
        ],
    ]
},

moretamcbnl: {
    video: [
        'https://rumble.com/embed/v6nmrie/?pub=4jqwl4',
        'https://rumble.com/embed/v6nms6m/?pub=4jqwl4',
        'https://rumble.com/embed/v6nmrj0/?pub=4jqwl4',
        'https://rumble.com/embed/v6nms6w/?pub=4jqwl4',
        'https://rumble.com/embed/v6nmrjg/?pub=4jqwl4',
        'https://rumble.com/embed/v6nms7g/?pub=4jqwl4',
        'https://rumble.com/embed/v6nmrk2/?pub=4jqwl4',
        'https://rumble.com/embed/v6nms8s/?pub=4jqwl4',
        'https://rumble.com/embed/v6nmroo/?pub=4jqwl4',
        'https://rumble.com/embed/v6nmsdo/?pub=4jqwl4',
        'https://rumble.com/embed/v6nmrpk/?pub=4jqwl4',
        'https://rumble.com/embed/v6nmse6/?pub=4jqwl4',
        'https://rumble.com/embed/v6nmrq2/?pub=4jqwl4',
        'https://rumble.com/embed/v6nmsek/?pub=4jqwl4',
        'https://rumble.com/embed/v6nmrqk/?pub=4jqwl4',
        'https://rumble.com/embed/v6nmsf6/?pub=4jqwl4',
        'https://rumble.com/embed/v6nmrvu/?pub=4jqwl4',
        'https://rumble.com/embed/v6nmsj8/?pub=4jqwl4',
        'https://rumble.com/embed/v6nmrwk/?pub=4jqwl4',
        'https://rumble.com/embed/v6nmsjk/?pub=4jqwl4',
        'https://rumble.com/embed/v6nmrx2/?pub=4jqwl4',
        'https://rumble.com/embed/v6nmsk8/?pub=4jqwl4',
        'https://rumble.com/embed/v6nmrxg/?pub=4jqwl4',
        'https://rumble.com/embed/v6nmsks/?pub=4jqwl4'
    ],
    episodeTitles: [
            '1. Living in the Same Place, but Not Living Together',
            'JP 1. Living in the Same Place, but Not Living Together',
            '2. Imagined, but Not Real',
            'JP 2. Imagined, but Not Real',
            '3. Broken Up, and Not Rekindled',
            'JP 3. Broken Up, and Not Rekindled',
            '4. A Hero, but Not the Main Character',
            'JP 4. A Hero, but Not the Main Character',
            '5. More Than a Nosebleed, but Less Than a Kiss',
            'JP 5. More Than a Nosebleed, but Less Than a Kiss',
            '6. A Male Virgin, but No Female Virgin',
            'JP 6. A Male Virgin, but No Female Virgin',
            '7. Fireworks, but No Embrace',
            'JP 7. Fireworks, but No Embrace',
            '8. An Entreaty, but No Reassurance.',
            'JP 8. An Entreaty, but No Reassurance.',
            '9. More Than a Childhood Friend, but Not True Love.',
            'JP 9. More Than a Childhood Friend, but Not True Love.',
            '10. Already Has Passed, but Not Yet.',
            'JP 10. Already Has Passed, but Not Yet.',
            '11. More Than a Confession, but Not Yet a Broken Heart.',
            'JP 11. More Than a Confession, but Not Yet a Broken Heart.',
            '12. Done, Being Less Than Love.',
            'JP 12. Done, Being Less Than Love.'
        ],
    customDownloads: [
        [
            { url: 'https://buzzheavier.com/3bfc42jgo0zv', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/3bfc42jgo0zv', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/3bfc42jgo0zv', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/3bfc42jgo0zv', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/3bfc42jgo0zv', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/3bfc42jgo0zv', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/3bfc42jgo0zv', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/3bfc42jgo0zv', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/3bfc42jgo0zv', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/3bfc42jgo0zv', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/3bfc42jgo0zv', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/3bfc42jgo0zv', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/3bfc42jgo0zv', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/3bfc42jgo0zv', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/3bfc42jgo0zv', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/3bfc42jgo0zv', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/3bfc42jgo0zv', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/3bfc42jgo0zv', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/3bfc42jgo0zv', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/3bfc42jgo0zv', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/3bfc42jgo0zv', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/3bfc42jgo0zv', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/3bfc42jgo0zv', name: 'Buzzheavier download' },
        ],            [
            { url: 'https://buzzheavier.com/3bfc42jgo0zv', name: 'Buzzheavier download' },
        ],
    ]
},

};

let currentMovie = null;
let currentEpisode = 0;

function updateActiveEpisodeUI(index) {
    const episodes = document.querySelectorAll('.episode');
    episodes.forEach(ep => ep.classList.remove('active'));
    if (episodes[index]) episodes[index].classList.add('active');
}

function updateDownloadButton() {
    // Clear existing download buttons
    downloadContainer.innerHTML = '';

    // Get the current movie's custom downloads for the selected episode
    const episodeDownloads = movies[currentMovie].customDownloads[currentEpisode];

    // Check if downloads exist for the episode
    if (episodeDownloads && episodeDownloads.length > 0) {
        // Create download buttons dynamically
        episodeDownloads.forEach(download => {
            const downloadButton = document.createElement('a');
            downloadButton.href = download.url;
            downloadButton.textContent = download.name;
            downloadButton.classList.add('button');
            downloadContainer.appendChild(downloadButton);
        });
    } else {
        // Fallback in case there are no custom downloads for the episode
        const noDownloadsMessage = document.createElement('p');
        noDownloadsMessage.textContent = 'No downloads available for this episode';
        downloadContainer.appendChild(noDownloadsMessage);
    }
}

function updateEpisodeSidebar() {
    episodeSidebar.innerHTML = ''; // Clear current episode list

    movies[currentMovie].video.forEach((videoUrl, index) => {
        const episodeDiv = document.createElement('div');
        episodeDiv.textContent = movies[currentMovie].episodeTitles[index]; // Use the episode title
        episodeDiv.classList.add('episode');
        episodeDiv.dataset.episodeIndex = index;

        episodeDiv.addEventListener('click', () => {
            videoPlayer.src = videoUrl;
            currentEpisode = index;
            updateActiveEpisodeUI(index);
            updateDownloadButton();
        });

        episodeSidebar.appendChild(episodeDiv);
    });

    // Ensure only the episode list is scrollable
    episodeSidebar.style.maxHeight = '700px'; // Set a fixed max height
    episodeSidebar.style.overflowY = 'auto';  // Enable scrolling when needed
    episodeSidebar.style.overflowX = 'hidden';  // Enable scrolling when needed
}



movieItems.forEach(movie => {
    movie.addEventListener('click', () => {
        currentMovie = movie.dataset.movie;

        if (movies[currentMovie]) {
            const movieData = movies[currentMovie];
            currentEpisode = 0;

            // Create the new episode list
            updateEpisodeSidebar();

            // Set the first episode as the default
            if (movieData.video.length > 0) {
                videoPlayer.src = movieData.video[0];
                updateActiveEpisodeUI(0);
                updateDownloadButton();
            }

            episodeContainer.style.display = 'flex';
        }
    });
});

episodeSidebar.addEventListener('click', (event) => {
    if (event.target.classList.contains('episode')) {
        const index = event.target.dataset.episodeIndex;
        videoPlayer.src = movies[currentMovie].video[index]; // Update video player
        currentEpisode = index; // Update the current episode index
        updateActiveEpisodeUI(currentEpisode); // Highlight the selected episode
        updateDownloadButton(); // Update the download section
    }
});

nextEpisodeButton.addEventListener('click', () => {
    if (currentMovie && currentEpisode < movies[currentMovie].video.length - 1) {
        currentEpisode++;
        videoPlayer.src = movies[currentMovie].video[currentEpisode];
        updateActiveEpisodeUI(currentEpisode);
        updateDownloadButton();
    }
});

prevEpisodeButton.addEventListener('click', () => {
    if (currentMovie && currentEpisode > 0) {
        currentEpisode--;
        videoPlayer.src = movies[currentMovie].video[currentEpisode];
        updateActiveEpisodeUI(currentEpisode);
        updateDownloadButton();
    }
});

let debounceTimer;
searchInput.addEventListener('input', function () {
    clearTimeout(debounceTimer);
    const query = searchInput.value.toLowerCase();
    debounceTimer = setTimeout(() => {
        movieItems.forEach(item => {
            const title = item.querySelector('p').textContent.toLowerCase();
            if (title.includes(query)) {
                item.style.display = '';  // Show the movie item
            } else {
                item.style.display = 'none';  // Hide the movie item
            }
        });
    }, 300);
    banners.forEach(banner => {
        banner.style.display = query ? 'none' : 'block';});
}
);

document.getElementById('backToMenu').addEventListener('click', e => {
    e.preventDefault();
    window.location.href = 'https://virowatch.tiiny.site'; // Replace 'https://example.com' with your desired URL
});
