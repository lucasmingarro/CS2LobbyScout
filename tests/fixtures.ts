/** Realistic CS2 `status` output (ids are synthetic). */
export const CS2_STATUS = `Server: Running [111.0.0.0 CSGO official server]
Client: Connected [-tickrate 64]
Source  : Valve (Steam)
@ Current  :  game
---------spawngroups----
  2:  SV:  [1: de_mirage | main lump | mapload]
---------players--------
  id     time ping loss      state   rate adr name
  0      06:53   35    0     active 786432 [U:1:148989393] 'DeadInside'
  1      06:52   61    0     active 786432 [U:1:1234567] 'aim.exe'
  2      06:50   22    0     active 786432 [U:1:99999999] 'pepe with spaces'
  3      06:49   40    0     active 786432 [U:1:42] 'Nobody'
  4      06:48   88    3     active 786432 [U:1:777777777] 'xXProXx'
  5      06:47   30    0     active 786432 [U:1:55555] 'it's quoted'
 65535   BOT   ...   0    0     active 786432 BOT 'Cliffe'
  7      00:12   50    0   spawning 786432 [U:1:8888] 'late joiner'
#end
`

export const CSGO_STATUS = `hostname: Valve CS:GO EU West Server (srcds1035-fra2.164.7)
version : 1.38.4.7 secure
players : 10 humans, 0 bots (10/0 max) (not hibernating)

# userid name uniqueid connected ping loss state rate
#  3 1 "nick one" STEAM_1:0:12345 05:23 61 0 active 196608
#  4 2 "nick \\"two\\"" STEAM_1:1:67890 05:20 40 0 active 196608
#  5 3 "nick three" STEAM_1:0:12345 05:19 33 0 active 196608
#end
`
