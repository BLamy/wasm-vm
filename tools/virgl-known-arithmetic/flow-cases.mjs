// Literal bounded-flow fixtures; source fixture custody is explicit.
export const FLOW_CASES = [
  {
    "name": "bounded-loop-known-producer",
    "stage": "vertex",
    "text": "VERT\nDCL IN[0]\nDCL OUT[0], POSITION\nDCL OUT[1], GENERIC[0]\nDCL TEMP[0..117]\nDCL CONST[0..45]\nDCL ADDR[0]\nIMM[0] UINT32 {0,1,4,16}\nIMM[1] UINT32 {11,176,432,144}\nIMM[2] UINT32 {448,8388607,1056964608,0}\nIMM[3] FLT32 {0.5,0.25,0,1}\nMOV TEMP[0].x, IMM[3].zzzz\nMOV TEMP[1].x, IMM[1].xxxx\nMOV TEMP[2].x, IMM[0].wwww\nMOV TEMP[3].x, IMM[0].yyyy\nBGNLOOP :0\nUARL ADDR[0].x, TEMP[1]\nMOV TEMP[4].x, CONST[ADDR[0].x].xxxx\nFSLT TEMP[5].x, TEMP[0].xxxx, TEMP[4].xxxx\nISGE TEMP[6].x, TEMP[3].xxxx, CONST[9].xxxx\nOR TEMP[7].x, TEMP[5].xxxx, TEMP[6].xxxx\nUIF TEMP[7].xxxx\nBRK\nENDIF\nUADD TEMP[8].x, TEMP[3].xxxx, IMM[0].yyyy\nSHL TEMP[9].x, TEMP[3].xxxx, IMM[0].zzzz\nUADD TEMP[2].x, TEMP[9].xxxx, IMM[0].wwww\nUADD TEMP[10].x, IMM[1].yyyy, TEMP[9].xxxx\nUSHR TEMP[1].x, TEMP[10].xxxx, IMM[0].zzzz\nMOV TEMP[3].x, TEMP[8].xxxx\nENDLOOP :0\nUSNE TEMP[11].x, TEMP[3].xxxx, CONST[9].xxxx\nUIF TEMP[11].xxxx\nSHL TEMP[12].x, TEMP[3].xxxx, IMM[0].zzzz\nUADD TEMP[13].xy, IMM[1].zwzz, TEMP[12].xxxx\nUSHR TEMP[14].xy, TEMP[13].xyxx, IMM[0].zzzz\nMOV TEMP[15].x, TEMP[14].yxxx\nUARL ADDR[0].x, TEMP[15].xxxx\nMOV TEMP[16].x, CONST[ADDR[0].x].xxxx\nUADD TEMP[17].x, IMM[2].xxxx, TEMP[2].xxxx\nUSHR TEMP[18].x, TEMP[17].xxxx, IMM[0].zzzz\nUARL ADDR[0].x, TEMP[18].xxxx\nMOV TEMP[19], CONST[ADDR[0].x]\nMOV TEMP[20].x, TEMP[14].xxxx\nUARL ADDR[0].x, TEMP[20].xxxx\nMOV TEMP[21], CONST[ADDR[0].x]\nENDIF\nADD TEMP[22], IMM[3], IMM[3]\nF2I TEMP[23], TEMP[22]\nI2F OUT[1], TEMP[23]\nMOV OUT[0], IN[0]\nEND\n",
    "ok": true,
    "sourceFixture": {
      "path": "renderer/virgl-shader/tests/bounded-loop-cases.json",
      "sha256": "0eec49f7e11ff80fbcf84ef723df88126061c04ea17ddc70de26fc7529ba1653",
      "name": "loop-small-vertex"
    }
  }
];
