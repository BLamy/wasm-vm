// Predecessor control/precision policies are carried without new wrapper authority.
export const HELD_CASES = [
  {
    "name": "held/profile-17-vertex",
    "stage": "vertex",
    "text": "VERT\nDCL IN[0]\nDCL OUT[0], POSITION\nDCL OUT[1], GENERIC[0]\nDCL CONST[0..45]\nDCL TEMP[0..117]\nIMM[0] UINT32 {0, 255, 15, 1056964608}\nIMM[1] UINT32 {1, 23, 24, 25}\nIMM[2] UINT32 {26, 27, 28, 29}\nOR TEMP[9], CONST[0], IMM[0].xxxx\nMOV_PRECISE TEMP[117], TEMP[9]\nUSHR TEMP[116], TEMP[117], CONST[44].xxxx\nAND TEMP[116], TEMP[116], IMM[0].yyyy\nSHL TEMP[116], TEMP[116], IMM[0].zzzz\nOR TEMP[116], TEMP[116], IMM[0].wwww\nMOV OUT[1], TEMP[116]\nMOV OUT[0], IN[0]\nEND\n",
    "ok": true,
    "held": true,
    "expectedProfile": "virgl-webgl2-raw-bits-v17",
    "sourceFixture": {
      "path": "renderer/virgl-shader/tests/precise-word-cases.json",
      "sha256": "b3630a1489042dd7872d170e28decef3a27627028bd0ba36231d279199164064",
      "name": "profile-17-vertex"
    }
  },
  {
    "name": "held/profile-17-fragment",
    "stage": "fragment",
    "text": "FRAG\nDCL OUT[0], COLOR\nDCL CONST[0..45]\nDCL TEMP[0..117]\nIMM[0] UINT32 {0, 255, 15, 1056964608}\nIMM[1] UINT32 {1, 23, 24, 25}\nIMM[2] UINT32 {26, 27, 28, 29}\nOR TEMP[9], CONST[0], IMM[0].xxxx\nMOV_PRECISE TEMP[117], TEMP[9]\nUSHR TEMP[116], TEMP[117], CONST[44].xxxx\nAND TEMP[116], TEMP[116], IMM[1].xxxx\nSHL TEMP[9], TEMP[116], IMM[1].yyyy\nSHL TEMP[17], TEMP[116], IMM[1].zzzz\nOR TEMP[9], TEMP[9], TEMP[17]\nSHL TEMP[17], TEMP[116], IMM[1].wwww\nOR TEMP[9], TEMP[9], TEMP[17]\nSHL TEMP[17], TEMP[116], IMM[2].xxxx\nOR TEMP[9], TEMP[9], TEMP[17]\nSHL TEMP[17], TEMP[116], IMM[2].yyyy\nOR TEMP[9], TEMP[9], TEMP[17]\nSHL TEMP[17], TEMP[116], IMM[2].zzzz\nOR TEMP[9], TEMP[9], TEMP[17]\nSHL TEMP[17], TEMP[116], IMM[2].wwww\nOR TEMP[9], TEMP[9], TEMP[17]\nMOV OUT[0], TEMP[9]\nEND\n",
    "ok": true,
    "held": true,
    "expectedProfile": "virgl-webgl2-raw-bits-v17",
    "sourceFixture": {
      "path": "renderer/virgl-shader/tests/precise-word-cases.json",
      "sha256": "b3630a1489042dd7872d170e28decef3a27627028bd0ba36231d279199164064",
      "name": "profile-17-fragment"
    }
  },
  {
    "name": "held/profile-19-vertex",
    "stage": "vertex",
    "text": "VERT\nDCL IN[0]\nDCL IN[1]\nDCL IN[2]\nDCL IN[3]\nDCL OUT[0], POSITION\nDCL OUT[1], GENERIC[0]\nDCL CONST[0..45]\nDCL TEMP[0..117]\nUIF CONST[44].xxxx\nMOV_PRECISE OUT[1], IN[2]\nELSE\nMOV OUT[1], IN[3]\nENDIF\nMOV OUT[0], IN[0]\nEND\n",
    "ok": true,
    "held": true,
    "expectedProfile": "virgl-webgl2-raw-bits-v19",
    "sourceFixture": {
      "path": "renderer/virgl-shader/tests/precise-word-cases.json",
      "sha256": "b3630a1489042dd7872d170e28decef3a27627028bd0ba36231d279199164064",
      "name": "profile-19-vertex"
    }
  },
  {
    "name": "held/profile-19-fragment",
    "stage": "fragment",
    "text": "FRAG\nDCL IN[1], GENERIC[0], CONSTANT\nDCL IN[2], GENERIC[1], CONSTANT\nDCL IN[3], GENERIC[2], CONSTANT\nDCL OUT[0], COLOR\nDCL CONST[0..45]\nDCL TEMP[0..117]\nUIF CONST[44].xxxx\nMOV_PRECISE OUT[0], IN[2]\nELSE\nMOV OUT[0], IN[3]\nENDIF\nEND\n",
    "ok": true,
    "held": true,
    "expectedProfile": "virgl-webgl2-raw-bits-v19",
    "sourceFixture": {
      "path": "renderer/virgl-shader/tests/precise-word-cases.json",
      "sha256": "b3630a1489042dd7872d170e28decef3a27627028bd0ba36231d279199164064",
      "name": "profile-19-fragment"
    }
  },
  {
    "name": "held/profile-23-vertex",
    "stage": "vertex",
    "text": "VERT\nDCL IN[0]\nDCL OUT[0], POSITION\nDCL OUT[1], GENERIC[0]\nDCL TEMP[0..117]\nDCL CONST[0..45]\nDCL ADDR[0]\nIMM[0] UINT32 {0,1,4,16}\nIMM[1] UINT32 {11,176,432,144}\nIMM[2] UINT32 {448,8388607,1056964608,0}\nIMM[3] FLT32 {0.5,0.25,0,1}\nMOV_PRECISE TEMP[0].x, IMM[3].zzzz\nMOV TEMP[1].x, IMM[1].xxxx\nMOV TEMP[2].x, IMM[0].wwww\nMOV TEMP[3].x, IMM[0].yyyy\nBGNLOOP :0\nUARL ADDR[0].x, TEMP[1]\nMOV TEMP[4].x, CONST[ADDR[0].x].xxxx\nFSLT TEMP[5].x, TEMP[0].xxxx, TEMP[4].xxxx\nISGE TEMP[6].x, TEMP[3].xxxx, CONST[9].xxxx\nOR TEMP[7].x, TEMP[5].xxxx, TEMP[6].xxxx\nUIF TEMP[7].xxxx\nBRK\nENDIF\nUADD TEMP[8].x, TEMP[3].xxxx, IMM[0].yyyy\nSHL TEMP[9].x, TEMP[3].xxxx, IMM[0].zzzz\nUADD TEMP[2].x, TEMP[9].xxxx, IMM[0].wwww\nUADD TEMP[10].x, IMM[1].yyyy, TEMP[9].xxxx\nUSHR TEMP[1].x, TEMP[10].xxxx, IMM[0].zzzz\nMOV TEMP[3].x, TEMP[8].xxxx\nENDLOOP :0\nUSNE TEMP[11].x, TEMP[3].xxxx, CONST[9].xxxx\nUIF TEMP[11].xxxx\nSHL TEMP[12].x, TEMP[3].xxxx, IMM[0].zzzz\nUADD TEMP[13].xy, IMM[1].zwzz, TEMP[12].xxxx\nUSHR TEMP[14].xy, TEMP[13].xyxx, IMM[0].zzzz\nMOV TEMP[15].x, TEMP[14].yxxx\nUARL ADDR[0].x, TEMP[15].xxxx\nMOV TEMP[16].x, CONST[ADDR[0].x].xxxx\nUADD TEMP[17].x, IMM[2].xxxx, TEMP[2].xxxx\nUSHR TEMP[18].x, TEMP[17].xxxx, IMM[0].zzzz\nUARL ADDR[0].x, TEMP[18].xxxx\nMOV TEMP[19], CONST[ADDR[0].x]\nMOV TEMP[20].x, TEMP[14].xxxx\nUARL ADDR[0].x, TEMP[20].xxxx\nMOV TEMP[21], CONST[ADDR[0].x]\nENDIF\nMOV OUT[1], IN[0]\nMOV OUT[0], IN[0]\nEND\n",
    "ok": true,
    "held": true,
    "expectedProfile": "virgl-webgl2-raw-bits-v23",
    "sourceFixture": {
      "path": "renderer/virgl-shader/tests/precise-word-cases.json",
      "sha256": "b3630a1489042dd7872d170e28decef3a27627028bd0ba36231d279199164064",
      "name": "profile-23-vertex"
    }
  },
  {
    "name": "held/profile-23-fragment",
    "stage": "fragment",
    "text": "FRAG\nDCL IN[1], GENERIC[0], CONSTANT\nDCL OUT[0], COLOR\nDCL TEMP[0..117]\nDCL CONST[0..45]\nDCL ADDR[0]\nIMM[0] UINT32 {0,1,4,16}\nIMM[1] UINT32 {11,176,432,144}\nIMM[2] UINT32 {448,8388607,1056964608,0}\nIMM[3] FLT32 {0.5,0.25,0,1}\nMOV_PRECISE TEMP[0].x, IMM[3].zzzz\nMOV TEMP[1].x, IMM[1].xxxx\nMOV TEMP[2].x, IMM[0].wwww\nMOV TEMP[3].x, IMM[0].yyyy\nBGNLOOP :0\nUARL ADDR[0].x, TEMP[1]\nMOV TEMP[4].x, CONST[ADDR[0].x].xxxx\nFSLT TEMP[5].x, TEMP[0].xxxx, TEMP[4].xxxx\nISGE TEMP[6].x, TEMP[3].xxxx, CONST[9].xxxx\nOR TEMP[7].x, TEMP[5].xxxx, TEMP[6].xxxx\nUIF TEMP[7].xxxx\nBRK\nENDIF\nUADD TEMP[8].x, TEMP[3].xxxx, IMM[0].yyyy\nSHL TEMP[9].x, TEMP[3].xxxx, IMM[0].zzzz\nUADD TEMP[2].x, TEMP[9].xxxx, IMM[0].wwww\nUADD TEMP[10].x, IMM[1].yyyy, TEMP[9].xxxx\nUSHR TEMP[1].x, TEMP[10].xxxx, IMM[0].zzzz\nMOV TEMP[3].x, TEMP[8].xxxx\nENDLOOP :0\nUSNE TEMP[11].x, TEMP[3].xxxx, CONST[9].xxxx\nUIF TEMP[11].xxxx\nSHL TEMP[12].x, TEMP[3].xxxx, IMM[0].zzzz\nUADD TEMP[13].xy, IMM[1].zwzz, TEMP[12].xxxx\nUSHR TEMP[14].xy, TEMP[13].xyxx, IMM[0].zzzz\nMOV TEMP[15].x, TEMP[14].yxxx\nUARL ADDR[0].x, TEMP[15].xxxx\nMOV TEMP[16].x, CONST[ADDR[0].x].xxxx\nUADD TEMP[17].x, IMM[2].xxxx, TEMP[2].xxxx\nUSHR TEMP[18].x, TEMP[17].xxxx, IMM[0].zzzz\nUARL ADDR[0].x, TEMP[18].xxxx\nMOV TEMP[19], CONST[ADDR[0].x]\nMOV TEMP[20].x, TEMP[14].xxxx\nUARL ADDR[0].x, TEMP[20].xxxx\nMOV TEMP[21], CONST[ADDR[0].x]\nENDIF\nMOV OUT[0], IN[1]\nEND\n",
    "ok": true,
    "held": true,
    "expectedProfile": "virgl-webgl2-raw-bits-v23",
    "sourceFixture": {
      "path": "renderer/virgl-shader/tests/precise-word-cases.json",
      "sha256": "b3630a1489042dd7872d170e28decef3a27627028bd0ba36231d279199164064",
      "name": "profile-23-fragment"
    }
  },
  {
    "name": "held/profile-24-vertex",
    "stage": "vertex",
    "text": "VERT\nDCL IN[0]\nDCL OUT[0], POSITION\nDCL OUT[1], GENERIC[0]\nDCL CONST[0..5]\nDCL TEMP[0..117]\nIMM[0] UINT32 {925353388,0,1065353216,5}\nMAX TEMP[0].x, CONST[4].xxxx, -CONST[4].xxxx\nFSLT TEMP[1].x, TEMP[0].xxxx, IMM[0].xxxx\nUIF TEMP[1].xxxx\nMOV_PRECISE TEMP[3], IMM[0].yyyy\nELSE\nMOV TEMP[2], CONST[5]\nENDIF\nADD TEMP[4], TEMP[2], IMM[0].yyyy\nMOV OUT[0], IN[0]\nMOV OUT[1], TEMP[4]\nEND\n",
    "ok": true,
    "held": true,
    "expectedProfile": "virgl-webgl2-raw-bits-v24",
    "sourceFixture": {
      "path": "renderer/virgl-shader/tests/precise-word-cases.json",
      "sha256": "b3630a1489042dd7872d170e28decef3a27627028bd0ba36231d279199164064",
      "name": "profile-24-vertex"
    }
  },
  {
    "name": "held/profile-24-fragment",
    "stage": "fragment",
    "text": "FRAG\nDCL IN[0], GENERIC[0], CONSTANT\nDCL OUT[0], COLOR\nDCL CONST[0..5]\nDCL TEMP[0..117]\nIMM[0] UINT32 {925353388,0,1065353216,5}\nMAX TEMP[0].x, CONST[4].xxxx, -CONST[4].xxxx\nFSLT TEMP[1].x, TEMP[0].xxxx, IMM[0].xxxx\nUIF TEMP[1].xxxx\nMOV_PRECISE TEMP[3], IMM[0].yyyy\nELSE\nMOV TEMP[2], CONST[5]\nENDIF\nADD TEMP[4], TEMP[2], IMM[0].yyyy\nMOV OUT[0], TEMP[4]\nEND\n",
    "ok": true,
    "held": true,
    "expectedProfile": "virgl-webgl2-raw-bits-v24",
    "sourceFixture": {
      "path": "renderer/virgl-shader/tests/precise-word-cases.json",
      "sha256": "b3630a1489042dd7872d170e28decef3a27627028bd0ba36231d279199164064",
      "name": "profile-24-fragment"
    }
  },
  {
    "name": "held/profile-26-vertex",
    "stage": "vertex",
    "text": "VERT\nDCL IN[0]\nDCL OUT[0], POSITION\nDCL OUT[1], GENERIC[0]\nDCL TEMP[0..117]\nDCL CONST[0..45]\nDCL ADDR[0]\nIMM[0] UINT32 {0,1,4,16}\nIMM[1] UINT32 {11,176,432,144}\nIMM[2] UINT32 {448,8388607,1056964608,0}\nIMM[3] FLT32 {0.5,0.25,0,1}\nIMM[4] UINT32 {925353388,0,0,0}\nMAX TEMP[110].w, CONST[4].xxxx, -CONST[4].xxxx\nFSLT TEMP[111].w, TEMP[110].wwww, IMM[4].xxxx\nUIF TEMP[111].wwww\nMOV_PRECISE TEMP[113], IMM[3].yyyy\nELSE\nMOV TEMP[112], CONST[5]\nENDIF\nADD TEMP[113], TEMP[112], IMM[3].zzzz\nMOV TEMP[0].x, IMM[3].zzzz\nMOV TEMP[1].x, IMM[1].xxxx\nMOV TEMP[2].x, IMM[0].wwww\nMOV TEMP[3].x, IMM[0].yyyy\nBGNLOOP :0\nUARL ADDR[0].x, TEMP[1]\nMOV TEMP[4].x, CONST[ADDR[0].x].xxxx\nFSLT TEMP[5].x, TEMP[0].xxxx, TEMP[4].xxxx\nISGE TEMP[6].x, TEMP[3].xxxx, CONST[9].xxxx\nOR TEMP[7].x, TEMP[5].xxxx, TEMP[6].xxxx\nUIF TEMP[7].xxxx\nBRK\nENDIF\nUADD TEMP[8].x, TEMP[3].xxxx, IMM[0].yyyy\nSHL TEMP[9].x, TEMP[3].xxxx, IMM[0].zzzz\nUADD TEMP[2].x, TEMP[9].xxxx, IMM[0].wwww\nUADD TEMP[10].x, IMM[1].yyyy, TEMP[9].xxxx\nUSHR TEMP[1].x, TEMP[10].xxxx, IMM[0].zzzz\nMOV TEMP[3].x, TEMP[8].xxxx\nENDLOOP :0\nUSNE TEMP[11].x, TEMP[3].xxxx, CONST[9].xxxx\nUIF TEMP[11].xxxx\nSHL TEMP[12].x, TEMP[3].xxxx, IMM[0].zzzz\nUADD TEMP[13].xy, IMM[1].zwzz, TEMP[12].xxxx\nUSHR TEMP[14].xy, TEMP[13].xyxx, IMM[0].zzzz\nMOV TEMP[15].x, TEMP[14].yxxx\nUARL ADDR[0].x, TEMP[15].xxxx\nMOV TEMP[16].x, CONST[ADDR[0].x].xxxx\nUADD TEMP[17].x, IMM[2].xxxx, TEMP[2].xxxx\nUSHR TEMP[18].x, TEMP[17].xxxx, IMM[0].zzzz\nUARL ADDR[0].x, TEMP[18].xxxx\nMOV TEMP[19], CONST[ADDR[0].x]\nMOV TEMP[20].x, TEMP[14].xxxx\nUARL ADDR[0].x, TEMP[20].xxxx\nMOV TEMP[21], CONST[ADDR[0].x]\nENDIF\nMOV OUT[1], TEMP[113]\nMOV OUT[0], IN[0]\nEND\n",
    "ok": true,
    "held": true,
    "expectedProfile": "virgl-webgl2-raw-bits-v26",
    "sourceFixture": {
      "path": "renderer/virgl-shader/tests/precise-word-cases.json",
      "sha256": "b3630a1489042dd7872d170e28decef3a27627028bd0ba36231d279199164064",
      "name": "profile-26-vertex"
    }
  },
  {
    "name": "held/profile-26-fragment",
    "stage": "fragment",
    "text": "FRAG\nDCL IN[1], GENERIC[0], CONSTANT\nDCL OUT[0], COLOR\nDCL TEMP[0..117]\nDCL CONST[0..45]\nDCL ADDR[0]\nIMM[0] UINT32 {0,1,4,16}\nIMM[1] UINT32 {11,176,432,144}\nIMM[2] UINT32 {448,8388607,1056964608,0}\nIMM[3] FLT32 {0.5,0.25,0,1}\nIMM[4] UINT32 {925353388,0,0,0}\nMAX TEMP[110].w, CONST[4].xxxx, -CONST[4].xxxx\nFSLT TEMP[111].w, TEMP[110].wwww, IMM[4].xxxx\nUIF TEMP[111].wwww\nMOV_PRECISE TEMP[113], IMM[3].yyyy\nELSE\nMOV TEMP[112], CONST[5]\nENDIF\nADD TEMP[113], TEMP[112], IMM[3].zzzz\nMOV TEMP[0].x, IMM[3].zzzz\nMOV TEMP[1].x, IMM[1].xxxx\nMOV TEMP[2].x, IMM[0].wwww\nMOV TEMP[3].x, IMM[0].yyyy\nBGNLOOP :0\nUARL ADDR[0].x, TEMP[1]\nMOV TEMP[4].x, CONST[ADDR[0].x].xxxx\nFSLT TEMP[5].x, TEMP[0].xxxx, TEMP[4].xxxx\nISGE TEMP[6].x, TEMP[3].xxxx, CONST[9].xxxx\nOR TEMP[7].x, TEMP[5].xxxx, TEMP[6].xxxx\nUIF TEMP[7].xxxx\nBRK\nENDIF\nUADD TEMP[8].x, TEMP[3].xxxx, IMM[0].yyyy\nSHL TEMP[9].x, TEMP[3].xxxx, IMM[0].zzzz\nUADD TEMP[2].x, TEMP[9].xxxx, IMM[0].wwww\nUADD TEMP[10].x, IMM[1].yyyy, TEMP[9].xxxx\nUSHR TEMP[1].x, TEMP[10].xxxx, IMM[0].zzzz\nMOV TEMP[3].x, TEMP[8].xxxx\nENDLOOP :0\nUSNE TEMP[11].x, TEMP[3].xxxx, CONST[9].xxxx\nUIF TEMP[11].xxxx\nSHL TEMP[12].x, TEMP[3].xxxx, IMM[0].zzzz\nUADD TEMP[13].xy, IMM[1].zwzz, TEMP[12].xxxx\nUSHR TEMP[14].xy, TEMP[13].xyxx, IMM[0].zzzz\nMOV TEMP[15].x, TEMP[14].yxxx\nUARL ADDR[0].x, TEMP[15].xxxx\nMOV TEMP[16].x, CONST[ADDR[0].x].xxxx\nUADD TEMP[17].x, IMM[2].xxxx, TEMP[2].xxxx\nUSHR TEMP[18].x, TEMP[17].xxxx, IMM[0].zzzz\nUARL ADDR[0].x, TEMP[18].xxxx\nMOV TEMP[19], CONST[ADDR[0].x]\nMOV TEMP[20].x, TEMP[14].xxxx\nUARL ADDR[0].x, TEMP[20].xxxx\nMOV TEMP[21], CONST[ADDR[0].x]\nENDIF\nMOV OUT[0], TEMP[113]\nEND\n",
    "ok": true,
    "held": true,
    "expectedProfile": "virgl-webgl2-raw-bits-v26",
    "sourceFixture": {
      "path": "renderer/virgl-shader/tests/precise-word-cases.json",
      "sha256": "b3630a1489042dd7872d170e28decef3a27627028bd0ba36231d279199164064",
      "name": "profile-26-fragment"
    }
  },
  {
    "name": "held/plain-vertex",
    "stage": "vertex",
    "text": "VERT\nDCL IN[0]\nDCL OUT[0], POSITION\nDCL OUT[1], GENERIC[0]\nDCL CONST[0..5]\nDCL TEMP[0..117]\nIMM[0] UINT32 {925353388,0,1065353216,5}\nMAX TEMP[0].x, CONST[4].xxxx, -CONST[4].xxxx\nFSLT TEMP[1].x, TEMP[0].xxxx, IMM[0].xxxx\nUIF TEMP[1].xxxx\nMOV TEMP[3], IMM[0].yyyy\nELSE\nMOV TEMP[2], CONST[5]\nENDIF\nADD TEMP[4], TEMP[2], IMM[0].yyyy\nMOV OUT[0], IN[0]\nMOV OUT[1], TEMP[4]\nEND\n",
    "ok": true,
    "held": true,
    "expectedProfile": "virgl-webgl2-raw-bits-v14",
    "sourceFixture": {
      "path": "renderer/virgl-shader/tests/radial-domain-cases.json",
      "sha256": "bf87fce0e9cf3edc279e70b291005f0f1621e7aecc2506b88a2b76e943b126bd",
      "name": "plain-vertex"
    }
  },
  {
    "name": "held/plain-fragment",
    "stage": "fragment",
    "text": "FRAG\nDCL IN[0], GENERIC[0], CONSTANT\nDCL OUT[0], COLOR\nDCL CONST[0..5]\nDCL TEMP[0..117]\nIMM[0] UINT32 {925353388,0,1065353216,5}\nMAX TEMP[0].x, CONST[4].xxxx, -CONST[4].xxxx\nFSLT TEMP[1].x, TEMP[0].xxxx, IMM[0].xxxx\nUIF TEMP[1].xxxx\nMOV TEMP[3], IMM[0].yyyy\nELSE\nMOV TEMP[2], CONST[5]\nENDIF\nADD TEMP[4], TEMP[2], IMM[0].yyyy\nMOV OUT[0], TEMP[4]\nEND\n",
    "ok": true,
    "held": true,
    "expectedProfile": "virgl-webgl2-raw-bits-v14",
    "sourceFixture": {
      "path": "renderer/virgl-shader/tests/radial-domain-cases.json",
      "sha256": "bf87fce0e9cf3edc279e70b291005f0f1621e7aecc2506b88a2b76e943b126bd",
      "name": "plain-fragment"
    }
  },
  {
    "name": "held/known-supplemental-zero-return-vector",
    "stage": "fragment",
    "text": "FRAG\nDCL IN[0], GENERIC[0], PERSPECTIVE\nDCL OUT[0], COLOR\nDCL TEMP[0..7]\nDCL CONST[0..45]\nIMM[0] UINT32 {0,1069547520,1065353216,0}\nIMM[1] UINT32 {1069547520,0,3212836864,1065353216}\nADD TEMP[0], IMM[0], IMM[1]\nF2I TEMP[1], TEMP[0]\nI2F OUT[0], TEMP[1]\nEND\n",
    "ok": true,
    "held": true,
    "expectedProfile": "virgl-webgl2-raw-bits-v40",
    "sourceFixture": {
      "path": "tools/virgl-known-arithmetic/supplement-cases.json",
      "sha256": "f1a39129b47ef7f81e40292ccea68415b5c4a8eabe28270bcf8c37e92ef61c6b",
      "name": "supplemental-zero-return-vector"
    }
  },
  {
    "name": "held/known-supplemental-coordinate-wrapper",
    "stage": "fragment",
    "text": "FRAG\nPROPERTY FS_COORD_ORIGIN LOWER_LEFT\nPROPERTY FS_COORD_PIXEL_CENTER HALF_INTEGER\nDCL IN[0], POSITION, LINEAR\nDCL OUT[0], COLOR\nDCL TEMP[0..7]\nIMM[0] UINT32 {1048576000,1048576000,1048576000,1048576000}\nIMM[1] UINT32 {1056964608,1056964608,1056964608,1056964608}\nADD TEMP[0], IMM[0], IMM[1]\nSIN TEMP[1], TEMP[0]\nADD OUT[0], TEMP[1], IN[0]\nEND\n",
    "ok": true,
    "held": true,
    "expectedProfile": "virgl-webgl2-raw-bits-v40",
    "sourceFixture": {
      "path": "tools/virgl-known-arithmetic/supplement-cases.json",
      "sha256": "f1a39129b47ef7f81e40292ccea68415b5c4a8eabe28270bcf8c37e92ef61c6b",
      "name": "supplemental-coordinate-wrapper"
    }
  },
  {
    "name": "held/known-both-operation-wrapper",
    "stage": "fragment",
    "text": "FRAG\nDCL IN[0], GENERIC[0], PERSPECTIVE\nDCL OUT[0], COLOR\nDCL TEMP[0..7]\nDCL CONST[0..45]\nIMM[0] UINT32 {1048576000,1048576000,1048576000,1048576000}\nIMM[1] UINT32 {1056964608,1056964608,1056964608,1056964608}\nADD TEMP[0], IMM[0], IMM[1]\nMUL TEMP[0], TEMP[0], IMM[1]\nSIN OUT[0], TEMP[0]\nEND\n",
    "ok": true,
    "held": true,
    "expectedProfile": "virgl-webgl2-raw-bits-v40",
    "sourceFixture": {
      "path": "tools/virgl-known-arithmetic/supplement-cases.json",
      "sha256": "f1a39129b47ef7f81e40292ccea68415b5c4a8eabe28270bcf8c37e92ef61c6b",
      "name": "both-operation-wrapper"
    }
  },
  {
    "name": "held/known-ADD/SIN OUT[0], TEMP[0]",
    "stage": "fragment",
    "text": "FRAG\nDCL IN[0], GENERIC[0], PERSPECTIVE\nDCL OUT[0], COLOR\nDCL CONST[0..45]\nDCL TEMP[0..6]\nIMM[0] UINT32 {1048576000,1048576000,1048576000,1048576000}\nIMM[1] UINT32 {1056964608,1056964608,1056964608,1056964608}\nIMM[2] UINT32 {1073741824,1073741824,1073741824,1073741824}\nADD TEMP[0], IMM[0], IMM[1]\nSIN OUT[0], TEMP[0]\nEND\n",
    "ok": true,
    "held": true,
    "expectedProfile": "virgl-webgl2-raw-bits-v40",
    "sourceFixture": {
      "path": "tools/virgl-known-arithmetic/supplement-cases.json",
      "sha256": "f1a39129b47ef7f81e40292ccea68415b5c4a8eabe28270bcf8c37e92ef61c6b",
      "name": "ADD/SIN OUT[0], TEMP[0]"
    }
  }
];
