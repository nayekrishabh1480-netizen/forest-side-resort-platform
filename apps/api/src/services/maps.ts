export function createMapLink(location = 'Guptkashi, Rudraprayag, Uttarakhand') {
  const url = new URL('https://www.google.com/maps/search/');
  url.searchParams.set('api', '1');
  url.searchParams.set('query', location);
  return { available: true, exactPinConfirmed: false, location, url: url.toString() };
}
