function findQueryParam(param_name, url = '' + window.location) {
    function searchForParam(split_with) {
        let qs = url.split(split_with);
        if (qs.length < 1) return undefined;
        qs = qs[1];
        let search_params = new URLSearchParams(qs);
        if (search_params.has(param_name)) {
            return { value: search_params.get(param_name) }
        } else if (split_with == '?' && qs.indexOf('#') > -1) {
            return searchForParam('#')
        }
    }
    let result = searchForParam('?');
    if (result) return result.value;

    result = searchForParam('#');
    return result ? result.value : undefined;
}