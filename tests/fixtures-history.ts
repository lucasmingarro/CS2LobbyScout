/** Synthetic reproduction of the steamcommunity.com CS2 match history markup. */
const player = (id: string, name: string, k: number, a: number, d: number, mvp: number, hsp: number, score: number, vanity = false): string => `
  <tr>
    <td class="inner_name">
      <div class="steam_avatar"><a href="https://steamcommunity.com/${vanity ? `id/${id}` : `profiles/${id}`}"><img src="https://avatars.steamstatic.com/${id}.jpg"></a></div>
      <div class="linkTitle"><a href="https://steamcommunity.com/${vanity ? `id/${id}` : `profiles/${id}`}">${name}</a></div>
    </td>
    <td>45</td><td>${k}</td><td>${a}</td><td>${d}</td><td>${mvp ? `★${mvp}` : ''}</td><td>${hsp}%</td><td>${score}</td>
  </tr>`

export const ME = '76561198973228659'

export const HISTORY_HTML = `<html><body>
<script>var g_sGcContinueToken = "AAAABBBB1234";</script>
<table class="generic_kv_table csgo_scoreboard_root">
<tbody>
<tr>
  <td class="val_left">
    <table class="csgo_scoreboard_inner_left"><tbody>
      <tr><td>Competitive</td></tr>
      <tr><td>Office</td></tr>
      <tr><td>2026-09-05 18:40:30 GMT</td></tr>
      <tr><td>Wait Time: 0:20</td></tr>
      <tr><td>Match Duration: 30:40</td></tr>
      <tr><td><a href="http://replay188.valve.net/730/003742811223344556677_1234567890.dem.bz2" class="csgo_scoreboard_btn_gotv">Download GOTV Replay</a></td></tr>
    </tbody></table>
  </td>
  <td>
    <table class="csgo_scoreboard_inner_right"><tbody>
      <tr><th>Player Name</th><th>Ping</th><th>K</th><th>A</th><th>D</th><th>★</th><th>HSP</th><th>Score</th></tr>
      ${player('76561198000000001', 'Ramiirez', 21, 5, 14, 2, 55, 50)}
      ${player('76561198000000002', 'Ø', 15, 3, 16, 0, 40, 33)}
      ${player('76561198000000003', 'xXZedScoutXx', 18, 7, 15, 1, 61, 44)}
      ${player('76561198000000004', 'iTzDMR_17', 9, 2, 17, 0, 30, 20)}
      ${player('76561198000000005', 'éogu', 12, 4, 16, 1, 48, 30)}
      <tr><td colspan="8" class="csgo_scoreboard_score">13 : 9</td></tr>
      ${player('76561198000000006', 'Luhhh', 20, 2, 15, 3, 70, 48)}
      ${player('76561198000000007', '3siete', 14, 6, 15, 0, 35, 34)}
      ${player('custom_vanity', '[L J T]ティジペラルタ', 11, 1, 15, 0, 20, 25, true)}
      ${player('76561198000000009', 'tremendo', 8, 3, 15, 0, 25, 18)}
      ${player(ME, 'blinky', 16, 4, 15, 1, 50, 38)}
    </tbody></table>
  </td>
</tr>
<tr>
  <td class="val_left">
    <table class="csgo_scoreboard_inner_left"><tbody>
      <tr><td>Competitive</td></tr>
      <tr><td>Mirage</td></tr>
      <tr><td>2026-09-04 22:01:02 GMT</td></tr>
      <tr><td>Wait Time: 1:05</td></tr>
      <tr><td>Match Duration: 41:12</td></tr>
    </tbody></table>
  </td>
  <td>
    <table class="csgo_scoreboard_inner_right"><tbody>
      <tr><th>Player Name</th><th>Ping</th><th>K</th><th>A</th><th>D</th><th>★</th><th>HSP</th><th>Score</th></tr>
      ${player(ME, 'blinky', 25, 4, 15, 4, 50, 60)}
      ${player('76561198000000011', 'mate', 10, 4, 20, 0, 50, 25)}
      <tr><td colspan="8" class="csgo_scoreboard_score">13 : 13</td></tr>
      ${player('76561198000000012', 'foe', 22, 4, 15, 2, 50, 55)}
    </tbody></table>
  </td>
</tr>
</tbody>
</table>
</body></html>`
