const fs = require('fs').promises;
const cheerio = require('cheerio');

async function parsePlayersHTML() {
    try {
        // Read the HTML file
        const html = await fs.readFile('players.html', 'utf8');
        console.log('HTML file read successfully.');

        // Wrap the content in a root element to make it valid HTML
        const wrappedHtml = `<table>${html}</table>`;

        const $ = cheerio.load(wrappedHtml);
        console.log('HTML parsed with cheerio.');

        const players = [];

        // Iterate through each player row
        $('tr.player').each((index, element) => {
            const $el = $(element);
            const name = $el.find('.player__name').text().trim();
            let imageUrl = $el.find('.player__name-image').attr('src');
            const position = $el.find('.player__position').text().trim();
            const nationality = $el.find('.player__flag').attr('class').split(' ').pop();
            const country = $el.find('.player__country').text().trim();

            // Replace 40x40 with 250x250 in the image URL
            if (imageUrl) {
                imageUrl = imageUrl.replace('/40x40/', '/250x250/');
            }

            console.log(`Parsing player: ${name}`);

            players.push({
                name,
                imageUrl,
                position,
                nationality,
                country
            });
        });

        // Write the players array to a JSON file
        await fs.writeFile('players.json', JSON.stringify(players, null, 2));

        console.log(`Parsed ${players.length} players and saved to players.json`);
    } catch (error) {
        console.error('Error:', error);
    }
}

parsePlayersHTML();