export function messageEnvelope(content) {
  return {object:"response", status:"completed", error:null, output:[
    {type:"reasoning", summary:[]},
    {type:"message", role:"assistant", status:"completed", content},
  ]};
}

export function providerAnswer(text = "Review the next task with the founder.") {
  const value = JSON.stringify({kind:"suggestion", text});
  return Response.json(messageEnvelope([
    {type:"output_text", text:value.slice(0, 11)}, {type:"output_text", text:value.slice(11)},
  ]));
}
