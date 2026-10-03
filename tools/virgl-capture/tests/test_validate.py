import importlib.util
from pathlib import Path
import struct
import sys
import unittest

spec = importlib.util.spec_from_file_location("virgl_capture_validate", Path(__file__).parents[1] / "validate.py")
capture = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = capture
spec.loader.exec_module(capture)

# These are protocol literals, not generated from the decoder's name table.
VERTEX = b"VERT\nDCL IN[0]\nDCL OUT[0], POSITION\n  0: MOV OUT[0], IN[0]\n  1: END\n"


def command(opcode, object_type=0, payload=b""):
    if len(payload) % 4:
        raise ValueError("test packet payload is not word aligned")
    return struct.pack("<I", opcode | (object_type << 8) | ((len(payload) // 4) << 16)) + payload


def shader_packets(text=VERTEX, split=None, handle=3, stage=0, padding=b"\xa5"):
    source = text + b"\0"
    padded = source + padding * (-len(source) % 4)
    if split is None:
        split = len(padded)
    first = command(1, 4, struct.pack("<5I", handle, stage, len(source), 30, 0) + padded[:split])
    if split == len(padded):
        return [first]
    return [first, command(1, 4, struct.pack("<5I", handle, stage, 0x80000000 | split, 30, 0) + padded[split:])]


class FramingTests(unittest.TestCase):
    def test_pin_enum_has_expected_wire_numbers(self):
        self.assertEqual(capture.COMMANDS[8], "DRAW_VBO")
        self.assertEqual(capture.COMMANDS[45], "COPY_TRANSFER3D")
        self.assertEqual(capture.OBJECTS[4], "SHADER")

    def test_small_submission_includes_first_command_and_full_shader(self):
        decoder = capture.CommandDecoder()
        data = command(0) + shader_packets()[0] + command(8, payload=struct.pack("<12I", *([0] * 12)))
        self.assertLess(len(data), 4096)
        decoder.submit(data, 7, 4)
        report = decoder.finish()
        self.assertEqual(report["opcodes"], {"CREATE_OBJECT": 1, "DRAW_VBO": 1, "NOP": 1})
        self.assertEqual(report["shaderInstructions"], {"END": 1, "MOV": 1})
        self.assertEqual(decoder.shaders[capture.sha256(VERTEX)]["text"], VERTEX)
        self.assertEqual(report["submissions"][0]["bytes"], len(data))

    def test_cross_submission_continuation_and_padding(self):
        decoder = capture.CommandDecoder()
        first, second = shader_packets(split=20)
        decoder.submit(command(28, payload=struct.pack("<I", 9)) + first, 1, 10)
        with self.assertRaisesRegex(capture.CaptureError, "unfinished"):
            decoder.finish()
        decoder.submit(second, 1, 11)
        report = decoder.finish()
        occurrence = report["shaders"][capture.sha256(VERTEX)]["occurrences"][0]
        self.assertEqual(occurrence["subcontext"], 9)
        self.assertEqual([item["event"] for item in occurrence["packets"]], [10, 11])
        self.assertEqual([item["continuation"] for item in occurrence["packets"]], [False, True])

    def test_every_non_word_boundary_rejected(self):
        packet = shader_packets()[0]
        for length in range(1, len(packet)):
            with self.subTest(length=length), self.assertRaises(capture.CaptureError):
                decoder = capture.CommandDecoder()
                decoder.submit(packet[:length], 1, 1)
                decoder.finish()

    def test_unknown_codes_and_trailing_data(self):
        for data in (command(255), command(0, 255), shader_packets()[0] + b"x"):
            with self.subTest(data=data[:4]), self.assertRaises(capture.CaptureError):
                capture.CommandDecoder().submit(data, 1, 1)

    def test_continuation_offset_and_handle_are_not_trusted(self):
        first, second = shader_packets(split=20)
        for word_index, replacement in ((3, 0x80000010), (3, 0x80000018), (1, 4), (4, 31)):
            mutated = bytearray(second)
            struct.pack_into("<I", mutated, 4 * word_index, replacement)
            decoder = capture.CommandDecoder()
            decoder.submit(first, 1, 1)
            with self.subTest(word_index=word_index, replacement=replacement), self.assertRaises(capture.CaptureError):
                decoder.submit(mutated, 1, 2)

    def test_context_and_subcontext_isolation(self):
        first, second = shader_packets(split=20)
        for context, prefix in ((2, b""), (1, command(28, payload=struct.pack("<I", 9)))):
            decoder = capture.CommandDecoder()
            decoder.submit(first, 1, 1)
            with self.subTest(context=context), self.assertRaisesRegex(capture.CaptureError, "no initial"):
                decoder.submit(prefix + second, context, 2)

    def test_overlapping_creation_and_context_destruction(self):
        first, _ = shader_packets(split=20)
        decoder = capture.CommandDecoder()
        decoder.submit(first, 1, 1)
        with self.assertRaisesRegex(capture.CaptureError, "replaces unfinished"):
            decoder.submit(first, 1, 2)
        with self.assertRaisesRegex(capture.CaptureError, "destroyed with unfinished"):
            decoder.destroy_context(1)

    def test_declared_length_and_terminal_nul(self):
        for delta in (-4, -1, 1, 4):
            packet = bytearray(shader_packets()[0])
            struct.pack_into("<I", packet, 12, len(VERTEX) + 1 + delta)
            with self.subTest(delta=delta), self.assertRaises(capture.CaptureError):
                decoder = capture.CommandDecoder()
                decoder.submit(packet, 1, 1)
                decoder.finish()
        with self.assertRaisesRegex(capture.CaptureError, "terminal NUL"):
            capture.CommandDecoder().submit(shader_packets(VERTEX + b"\0junk")[0], 1, 1)

    def test_shader_stage_and_end_required(self):
        for text, stage in ((VERTEX, 1), (VERTEX.replace(b"  1: END\n", b""), 0)):
            with self.subTest(stage=stage), self.assertRaises(capture.CaptureError):
                capture.CommandDecoder().submit(shader_packets(text=text, stage=stage)[0], 1, 1)

    def test_streamout_header_offset_and_truncation(self):
        # Literal protocol layout: four strides, then two words per output.
        # These tests exercise extraction/framing, not streamout GPU semantics.
        text = VERTEX + b"\0"
        padded = text + b"\x00" * (-len(text) % 4)
        header = struct.pack("<5I", 3, 0, len(text), 30, 2)
        streamout = struct.pack("<8I", 16, 0, 0, 0, 0, 0, 1, 4)
        decoder = capture.CommandDecoder()
        decoder.submit(command(1, 4, header + streamout + padded), 1, 1)
        occurrence = decoder.finish()["shaders"][capture.sha256(VERTEX)]["occurrences"][0]
        self.assertEqual(occurrence["streamoutOutputs"], 2)
        for length in (4, 8, 28, 32):
            with self.subTest(length=length), self.assertRaises(capture.CaptureError):
                capture.CommandDecoder().submit(command(1, 4, header + streamout[:length]), 1, 1)

    def test_compute_local_memory_is_not_streamout_count(self):
        text = b"COMP\n  0: END\n"
        packet = bytearray(shader_packets(text=text, stage=5)[0])
        struct.pack_into("<I", packet, 20, 65536)
        decoder = capture.CommandDecoder()
        decoder.submit(packet, 1, 1)
        report = decoder.finish()
        self.assertEqual(report["shaders"][capture.sha256(text)]["stage"], "COMP")
        self.assertEqual(report["shaders"][capture.sha256(text)]["occurrences"][0]["streamoutOutputs"], 0)


if __name__ == "__main__":
    unittest.main()
