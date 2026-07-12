// Kurari Agent 用の Apple Intelligence（オンデバイスモデル）ラッパーCLI。
// 使い方:
//   kurari-apple-ai --check          # 利用可否を表示（利用可なら exit 0）
//   echo "<prompt>" | kurari-apple-ai  # stdin のプロンプトに応答して stdout へ
// ビルドは agent 側が初回起動時に swiftc で自動実行する（macOS 26+ / Apple Silicon）。
import Foundation
import FoundationModels

@main
struct KurariAppleAi {
    static func main() async {
        let model = SystemLanguageModel.default

        if CommandLine.arguments.contains("--check") {
            switch model.availability {
            case .available:
                print("apple-intelligence available")
                exit(0)
            case .unavailable(let reason):
                FileHandle.standardError.write("unavailable: \(reason)\n".data(using: .utf8)!)
                exit(1)
            @unknown default:
                FileHandle.standardError.write("unavailable: unknown\n".data(using: .utf8)!)
                exit(1)
            }
        }

        guard case .available = model.availability else {
            FileHandle.standardError.write("Apple Intelligence が利用できません（設定で有効化が必要）\n".data(using: .utf8)!)
            exit(1)
        }

        guard let data = try? FileHandle.standardInput.readToEnd(),
              let prompt = String(data: data, encoding: .utf8),
              !prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        else {
            FileHandle.standardError.write("stdin にプロンプトがありません\n".data(using: .utf8)!)
            exit(1)
        }

        let session = LanguageModelSession()
        do {
            let response = try await session.respond(to: prompt)
            print(response.content)
        } catch {
            // コンテキスト超過などはメッセージごと agent に返し、ジョブの failed 理由にする
            FileHandle.standardError.write("apple-ai error: \(error)\n".data(using: .utf8)!)
            exit(1)
        }
    }
}
