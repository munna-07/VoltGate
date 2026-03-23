package responses

import (
	. "github.com/voltgate/voltgate/v6/internal/constant"
	"github.com/voltgate/voltgate/v6/internal/interfaces"
	"github.com/voltgate/voltgate/v6/internal/translator/translator"
)

func init() {
	translator.Register(
		OpenaiResponse,
		GeminiCLI,
		ConvertOpenAIResponsesRequestToGeminiCLI,
		interfaces.TranslateResponse{
			Stream:    ConvertGeminiCLIResponseToOpenAIResponses,
			NonStream: ConvertGeminiCLIResponseToOpenAIResponsesNonStream,
		},
	)
}
